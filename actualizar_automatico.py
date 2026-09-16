import json
import os
from datetime import date

import requests
import yfinance as yf
import pandas as pd
from pywebpush import webpush, WebPushException
from supabase import create_client, Client

# Credenciales desde variables de entorno (seguro para automatización)
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
# URL publica del deploy de Cloudflare Pages, solo para leer /api/winrate* al cierre del dia.
# No es secreta, pero se configura como secret/variable del repo igual que las demas.
PAGES_BASE_URL = os.environ.get("PAGES_BASE_URL")
# Par de llaves VAPID (punto 12, Web Push). La privada solo vive aqui (GitHub Actions); la
# publica tambien se configura en Cloudflare Pages para que /api/public-config la exponga.
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY")
VAPID_CLAIM_EMAIL = os.environ.get("VAPID_CLAIM_EMAIL", "mailto:contact@thalgorithm.com")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

assets = [
    ("AAPL", "stock"), ("MSFT", "stock"), ("GOOGL", "stock"), ("AMZN", "stock"),
    ("NVDA", "stock"), ("META", "stock"), ("TSLA", "stock"), ("NFLX", "stock"),
    ("AMD", "stock"), ("INTC", "stock"), ("JPM", "stock"), ("V", "stock"),
    ("MA", "stock"), ("JNJ", "stock"), ("WMT", "stock"), ("PG", "stock"),
    ("DIS", "stock"), ("ASML", "stock"), ("TSM", "stock"), ("KO", "stock"),
    ("GC=F", "commodity"), ("SI=F", "commodity"), ("CL=F", "commodity"), ("BZ=F", "commodity"),
    ("NG=F", "commodity"), ("HG=F", "commodity"), ("ZC=F", "commodity"), ("ZW=F", "commodity"),
    ("ZS=F", "commodity"), ("KC=F", "commodity")
]

def backfill_asset_signals():
    """Backfill retroactivo de asset_signals (punto 9.2): recorre TODO el historial ya
    existente en asset_historical_prices (no solo desde hoy) y llena asset_signals con la
    profundidad completa. Se evalua por simbolo y es idempotente/autocurativa: si un simbolo
    ya esta al dia (una senal por cada par de cierres consecutivos), se omite sin costo; si
    le faltan filas (primera corrida tras este cambio, o un hueco), recalcula ese simbolo
    completo. Se llama ANTES de descargar/insertar el cierre de hoy, para que la comparacion
    de conteos no se desalinee por el nuevo dato del dia.
    """
    for symbol, asset_type in assets:
        try:
            prices_count = (
                supabase.table("asset_historical_prices")
                .select("date", count="exact")
                .eq("symbol", symbol)
                .execute()
                .count
            )
            if not prices_count or prices_count < 2:
                continue
            signals_count = (
                supabase.table("asset_signals")
                .select("date", count="exact")
                .eq("symbol", symbol)
                .execute()
                .count
            ) or 0
            if signals_count >= prices_count - 1:
                continue  # ya al dia, nada que recalcular para este simbolo

            history = (
                supabase.table("asset_historical_prices")
                .select("date,close")
                .eq("symbol", symbol)
                .order("date", desc=False)
                .execute()
                .data
            ) or []
            if len(history) < 2:
                continue

            rows = []
            for i in range(1, len(history)):
                prev_close = float(history[i - 1]["close"])
                curr_close = float(history[i]["close"])
                rows.append({
                    "symbol": symbol,
                    "date": history[i]["date"],
                    # Sube -> 1; baja o se mantiene -> 0 (comparacion estricta).
                    "signal": 1 if curr_close > prev_close else 0,
                })

            for start in range(0, len(rows), 500):
                chunk = rows[start:start + 500]
                supabase.table("asset_signals").upsert(chunk, on_conflict="symbol,date").execute()
            print(f"Backfill histórico de señales completado para {symbol}: {len(rows)} filas.")
        except Exception as e:
            print(f"Error en backfill de señales para {symbol}: {e}")


backfill_asset_signals()

daily_data = []
for symbol, asset_type in assets:
    try:
        df = yf.download(symbol, period="5d", interval="1d", progress=False)
        if df.empty:
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
        df = df.reset_index()
        last_row = df.iloc[-1]
        date_str = str(last_row['Date']).split(' ')[0]
        
        daily_data.append({
            "symbol": symbol,
            "asset_type": asset_type,
            "date": date_str,
            "open": float(last_row['Open']) if pd.notna(last_row['Open']) else None,
            "high": float(last_row['High']) if pd.notna(last_row['High']) else None,
            "low": float(last_row['Low']) if pd.notna(last_row['Low']) else None,
            "close": float(last_row['Close']) if pd.notna(last_row['Close']) else None,
            "volume": int(last_row['Volume']) if pd.notna(last_row['Volume']) else 0
        })
    except Exception as e:
        print(f"Error con {symbol}: {e}")

if daily_data:
    # Inserción directa en Supabase (upsert para evitar duplicados si corre dos veces)
    response = supabase.table("asset_historical_prices").upsert(
        daily_data, on_conflict="symbol,date"
    ).execute()
    print("Datos actualizados automáticamente en Supabase.")

# FASE 4 — paso 1 de la cascada: señal binaria (1 alza / 0 baja-o-igual) por activo, derivada
# por lectura de asset_historical_prices (nunca al revés). El backfill histórico ya corrió
# arriba con todo el pasado; aquí solo se inserta la señal del cierre de HOY que se acaba de
# upsert-ear, comparando contra el cierre inmediatamente anterior (liviano, sin recorrer todo
# el historial cada día).
signal_rows = []
for symbol, asset_type in assets:
    try:
        history = (
            supabase.table("asset_historical_prices")
            .select("date,close")
            .eq("symbol", symbol)
            .order("date", desc=True)
            .limit(2)
            .execute()
        )
        rows = history.data or []
        if len(rows) < 2:
            continue
        latest, previous = rows[0], rows[1]
        signal_rows.append({
            "symbol": symbol,
            "date": latest["date"],
            # Sube -> 1; baja o se mantiene -> 0 (misma regla estricta que el backfill).
            "signal": 1 if float(latest["close"]) > float(previous["close"]) else 0,
        })
    except Exception as e:
        print(f"Error de señal con {symbol}: {e}")

if signal_rows:
    supabase.table("asset_signals").upsert(signal_rows, on_conflict="symbol,date").execute()
    print("Señales binarias (asset_signals) actualizadas en Supabase.")

# FASE 4 — paso 2 de la cascada: recálculo diario del Win Rate (punto 9.8) de ambos motores,
# leyendo los endpoints ya desplegados en Cloudflare Pages (que hacen el backtest real) y
# guardando el resumen en win_rate_history para poder comparar legacy vs shadow_v2 con el
# tiempo. No es un cron independiente: corre como parte de esta misma cascada diaria.
if PAGES_BASE_URL:
    today = date.today().isoformat()
    for engine, path in (("legacy", "/api/winrate?all=1"), ("shadow_v2", "/api/winrate-shadow?all=1")):
        try:
            response = requests.get(f"{PAGES_BASE_URL.rstrip('/')}{path}", timeout=30)
            response.raise_for_status()
            payload = response.json()
            supabase.table("win_rate_history").upsert({
                "date": today,
                "engine": engine,
                "global_win_rate": payload.get("globalWinRate"),
                "details": payload,
            }, on_conflict="date,engine").execute()
            print(f"Win Rate ({engine}) registrado: {payload.get('globalWinRate')}")
        except Exception as e:
            print(f"Error registrando Win Rate ({engine}): {e}")
else:
    print("PAGES_BASE_URL no configurado; se omite el registro diario de Win Rate.")


# FASE 5 — paso final de la cascada: alertas por Web Push (punto 12, reemplaza WhatsApp).
# La meta y el simbolo viven en la propia fila de push_subscriptions (autocontenida, sin
# cuenta) porque el invitado es hoy toda la base real de usuarios. Se compara la fase actual
# (misma regla que portfolioState() en el frontend) contra la ultima fase conocida y solo se
# notifica en las 3 transiciones validas: entra amarillo, entra rojo, o sale a verde.
def send_push_alerts():
    if not VAPID_PUBLIC_KEY or not VAPID_PRIVATE_KEY:
        print("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no configuradas; se omiten las notificaciones push.")
        return

    subscriptions = supabase.table("push_subscriptions").select("*").execute().data or []
    if not subscriptions:
        return

    price_cache = {}
    phase_labels = {
        "red": "zona roja (meta alcanzada)",
        "yellow": "zona amarilla (cerca de meta)",
        "blue": "zona verde (en seguimiento)",
    }

    for sub in subscriptions:
        symbol = sub["asset_symbol"]
        try:
            if symbol not in price_cache:
                rows = (
                    supabase.table("asset_historical_prices")
                    .select("close")
                    .eq("symbol", symbol)
                    .order("date", desc=True)
                    .limit(1)
                    .execute()
                    .data
                )
                price_cache[symbol] = float(rows[0]["close"]) if rows else None
            price = price_cache[symbol]
            if price is None:
                continue

            goal = float(sub["goal"])
            distance = abs(goal - price) / price if price else 1
            if price >= goal:
                phase = "red"
            elif distance <= 0.03:
                phase = "yellow"
            else:
                phase = "blue"

            last_phase = sub.get("last_phase", "blue")
            valid_transition = phase != last_phase and (phase in ("yellow", "red") or last_phase in ("yellow", "red"))

            if valid_transition:
                try:
                    webpush(
                        subscription_info={
                            "endpoint": sub["endpoint"],
                            "keys": {"p256dh": sub["keys_p256dh"], "auth": sub["keys_auth"]},
                        },
                        data=json.dumps({
                            "title": f"ALGORITHM · {symbol}",
                            "body": f"Entró a {phase_labels.get(phase, phase)}. Precio: {price:.2f} · Meta: {goal:.2f}.",
                            "url": "https://thalgorithm.com/",
                        }),
                        vapid_private_key=VAPID_PRIVATE_KEY,
                        vapid_claims={"sub": VAPID_CLAIM_EMAIL},
                    )
                    print(f"Push enviado para {symbol}: {last_phase} -> {phase}")
                except WebPushException as e:
                    status = getattr(e.response, "status_code", None)
                    if status in (404, 410):
                        supabase.table("push_subscriptions").delete().eq("id", sub["id"]).execute()
                        print(f"Suscripción expirada/revocada eliminada ({symbol}).")
                        continue
                    print(f"Error enviando push ({symbol}): {e}")

            if phase != last_phase:
                supabase.table("push_subscriptions").update({
                    "last_phase": phase,
                    "updated_at": date.today().isoformat(),
                }).eq("id", sub["id"]).execute()
        except Exception as e:
            print(f"Error evaluando alerta push para {symbol}: {e}")


send_push_alerts()