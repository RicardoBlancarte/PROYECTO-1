import os
import yfinance as yf
import pandas as pd
from supabase import create_client, Client

# Credenciales desde variables de entorno (seguro para automatización)
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

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