import os
from datetime import date

import requests
import yfinance as yf
import pandas as pd
from supabase import create_client, Client

# Credenciales desde variables de entorno (seguro para automatización)
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
# URL publica del deploy de Cloudflare Pages, solo para leer /api/winrate* al cierre del dia.
# No es secreta, pero se configura como secret/variable del repo igual que las demas.
PAGES_BASE_URL = os.environ.get("PAGES_BASE_URL")

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

# FASE 4 — paso 1 de la cascada: señal binaria (1 alza / 0 baja) por activo, derivada por
# lectura de asset_historical_prices (nunca al revés), y persistida en asset_signals.
# Se calcula sobre la propia tabla ya actualizada arriba para no depender de que la ventana
# de 5 días de yfinance siempre tenga 2+ sesiones (fines de semana largos, feriados, etc.).
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
            "signal": 1 if float(latest["close"]) >= float(previous["close"]) else 0,
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