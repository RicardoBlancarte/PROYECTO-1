import inspect
import json
import os
import sys
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

if os.environ.get("ONLY_MONTECARLO") == "1":
    import montecarlo_engine
    montecarlo_engine.run_for_all_assets(supabase, assets)
    sys.exit(0)

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

# Precios diarios. Cada corrida descarga una ventana (PRICE_PERIOD: "5d" por defecto, "1mo"
# para el backfill manual desde workflow_dispatch). Por activo:
#   - Control de consistencia: si algún día de la ventana (anterior al más reciente) ya existe
#     en la base, se compara su close guardado con el descargado (el más reciente de esos días).
#     Si difieren más de la tolerancia, no se escribe nada de ese activo y se registra. La
#     tolerancia es CONSISTENCY_TOLERANCE_PCT para acciones e índices y FUTURES_TOLERANCE_PCT
#     para futuros (=F): su serie continua cambia de contrato al vencimiento, así que entre ambas
#     tolerancias se registra un "Aviso de cambio de contrato" y se continúa. El día más reciente
#     no sirve de referencia porque se puede corregir con upsert.
#   - La fecha más reciente de la ventana se guarda con upsert (se puede corregir cada noche).
#   - Las fechas anteriores que falten se insertan sin reescribir las existentes.
# Si un día llega sin cierre (Close NaN) se omite y se registra; la siguiente corrida lo vuelve
# a intentar dentro de su ventana. Cada activo se procesa aislado: un error no detiene la cascada.
PRICE_PERIOD = os.environ.get("PRICE_PERIOD") or "5d"
if PRICE_PERIOD not in ("5d", "1mo"):
    print(f"PRICE_PERIOD '{PRICE_PERIOD}' no permitido; se usa '5d'.")
    PRICE_PERIOD = "5d"
CONSISTENCY_TOLERANCE_PCT = 0.5   # acciones e índices
FUTURES_TOLERANCE_PCT = 10.0      # futuros (=F): cambio de contrato al vencimiento
print(f"Descarga de precios con ventana {PRICE_PERIOD}.")


def to_float(value):
    return float(value) if pd.notna(value) else None


new_rows_by_symbol = {}
inconsistent_symbols = []
for symbol, asset_type in assets:
    try:
        df = yf.download(symbol, period=PRICE_PERIOD, interval="1d", progress=False)
        if df.empty:
            print(f"{symbol}: yfinance no devolvió datos; se omite.")
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
        df = df.reset_index()

        candidates = []
        for _, row in df.iterrows():
            date_str = str(row['Date']).split(' ')[0]
            if pd.isna(row['Close']):
                print(f"Precio omitido: {symbol} {date_str} llegó sin cierre (Close NaN) desde yfinance.")
                continue
            candidates.append({
                "symbol": symbol,
                "asset_type": asset_type,
                "date": date_str,
                "open": to_float(row['Open']),
                "high": to_float(row['High']),
                "low": to_float(row['Low']),
                "close": float(row['Close']),
                "volume": int(row['Volume']) if pd.notna(row['Volume']) else 0
            })
        if not candidates:
            new_rows_by_symbol[symbol] = 0
            continue

        oldest = min(row["date"] for row in candidates)
        existing = (
            supabase.table("asset_historical_prices")
            .select("date,close")
            .eq("symbol", symbol)
            .gte("date", oldest)
            .execute()
            .data
        ) or []
        stored_close = {str(r["date"]): float(r["close"]) for r in existing}

        latest = max(candidates, key=lambda r: r["date"])
        # Control de consistencia contra el día ya guardado más reciente, anterior al último día.
        overlap = sorted((row for row in candidates if row["date"] in stored_close and row["date"] != latest["date"]), key=lambda r: r["date"])
        if not overlap:
            print(f"Consistencia: {symbol} sin día guardado anterior en la ventana para comparar.")
        else:
            ref = overlap[-1]
            saved = stored_close[ref["date"]]
            diff_pct = abs(ref["close"] - saved) / saved * 100 if saved else float("inf")
            is_future = symbol.endswith("=F")
            tolerance = FUTURES_TOLERANCE_PCT if is_future else CONSISTENCY_TOLERANCE_PCT
            if diff_pct > tolerance:
                print(f"Inconsistencia: {symbol} {ref['date']} guardado {saved} vs descargado {ref['close']} ({diff_pct:.2f} %, tolerancia {tolerance} %); no se escribe nada de {symbol}.")
                inconsistent_symbols.append(symbol)
                continue
            if is_future and diff_pct > CONSISTENCY_TOLERANCE_PCT:
                print(f"Aviso de cambio de contrato: {symbol} {ref['date']} guardado {saved} vs descargado {ref['close']} ({diff_pct:.2f} %); se continúa (tolerancia de futuros {FUTURES_TOLERANCE_PCT} %).")
            else:
                print(f"Consistencia OK: {symbol} {ref['date']} {saved} vs {ref['close']} ({diff_pct:.2f} %).")

        older_missing = [row for row in candidates if row["date"] != latest["date"] and row["date"] not in stored_close]
        if older_missing:
            supabase.table("asset_historical_prices").insert(older_missing).execute()
        supabase.table("asset_historical_prices").upsert(latest, on_conflict="symbol,date").execute()

        latest_is_new = latest["date"] not in stored_close
        new_dates = [row["date"] for row in older_missing] + ([latest["date"]] if latest_is_new else [])
        new_rows_by_symbol[symbol] = len(new_dates)
        detail = f" ({', '.join(sorted(new_dates))})" if new_dates else ""
        latest_note = "nuevo" if latest_is_new else "actualizado con upsert"
        print(f"{symbol}: {len(new_dates)} filas nuevas{detail}; último día {latest['date']} {latest_note}.")
    except Exception as e:
        print(f"Error con precios de {symbol}: {e}")

print(f"Precios: {sum(new_rows_by_symbol.values())} filas nuevas en total; "
      f"{len(new_rows_by_symbol)} de {len(assets)} activos procesados sin error; "
      f"{len(inconsistent_symbols)} omitidos por inconsistencia{(': ' + ', '.join(inconsistent_symbols)) if inconsistent_symbols else ''}.")

# Si algún activo recibió más de un día (backfill o recuperación de huecos), se recalculan sus
# señales ahora con la misma función idempotente de arriba, en vez de esperar a la siguiente corrida.
if any(count > 1 for count in new_rows_by_symbol.values()):
    backfill_asset_signals()

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
    try:
        supabase.table("asset_signals").upsert(signal_rows, on_conflict="symbol,date").execute()
        print("Señales binarias (asset_signals) actualizadas en Supabase.")
    except Exception as e:
        print(f"Error guardando señales binarias (asset_signals): {e}")

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

    # TTL de 24 h: con el valor por defecto de pywebpush (0), el servicio de push descarta el
    # mensaje si el dispositivo no está conectado en ese instante (Android en reposo).
    push_options = {"ttl": 86400}
    if "headers" in inspect.signature(webpush).parameters:
        push_options["headers"] = {"Urgency": "high"}
    print(f"Web Push: ttl={push_options['ttl']} s; Urgency: {'high' if 'headers' in push_options else 'no soportado por esta versión de pywebpush'}.")

    try:
        subscriptions = supabase.table("push_subscriptions").select("*").execute().data or []
    except Exception as e:
        print(f"Error leyendo push_subscriptions; se omiten las alertas push: {e}")
        return
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
                    response = webpush(
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
                        **push_options,
                    )
                    print(f"Push aceptado para {symbol}: {last_phase} -> {phase} (HTTP {response.status_code}, …{sub['endpoint'][-10:]})")
                except WebPushException as e:
                    status = getattr(e.response, "status_code", None)
                    if status in (404, 410):
                        supabase.table("push_subscriptions").delete().eq("id", sub["id"]).execute()
                        print(f"Suscripción expirada/revocada eliminada ({symbol}, HTTP {status}, …{sub['endpoint'][-10:]}).")
                        continue
                    body = (getattr(e.response, "text", "") or "")[:200].replace("\n", " ")
                    print(f"Error enviando push ({symbol}): HTTP {status} {body}".rstrip())

            if phase != last_phase:
                supabase.table("push_subscriptions").update({
                    "last_phase": phase,
                    "updated_at": date.today().isoformat(),
                }).eq("id", sub["id"]).execute()
        except Exception as e:
            print(f"Error evaluando alerta push para {symbol}: {e}")


send_push_alerts()

try:
    import montecarlo_engine
    montecarlo_engine.run_for_all_assets(supabase, assets)
except Exception as e:
    print(f"[montecarlo] error, cascada continua: {e}")