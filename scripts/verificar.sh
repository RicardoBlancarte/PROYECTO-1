#!/usr/bin/env bash
# Verificación de solo lectura de un despliegue (Preview de una rama o Producción) con curl.
#   bash scripts/verificar.sh preview <rama> [--guardar]
#   bash scripts/verificar.sh produccion [--guardar]
# No escribe en Supabase: solo hace GET/HEAD. No llama a /api/patterns ni a /api/news (esos escriben).
# Funciona en Git Bash de Windows: sin archivos temporales ni rm; las respuestas se leen por tubería.
# Salida: tabla Markdown con ✅/❌; código de salida 1 si hay algún ❌. Con --guardar la copia a qa-salida/.

set -u
export LANG=C.UTF-8 LC_ALL=C.UTF-8 PYTHONIOENCODING=utf-8
PY="${PY:-py}"

uso() { echo "Uso: bash scripts/verificar.sh preview <rama> [--guardar] | produccion [--guardar]" >&2; exit 2; }
[ $# -ge 1 ] || uso
case "$1" in
  preview)    [ $# -ge 2 ] || uso; OBJETIVO="preview-$2"; BASE="https://$2.algorithm-global-engine.pages.dev"; shift 2 ;;
  produccion) OBJETIVO="produccion"; BASE="https://thalgorithm.com"; shift ;;
  *) uso ;;
esac
GUARDAR=0; [ "${1:-}" = "--guardar" ] && GUARDAR=1

FILAS=(); FALLAS=0; N=0
fila() { # comprobación, esperado, resultado, ok(0/1)
  N=$((N + 1)); local marca="✅"; [ "$4" = 1 ] || { marca="❌"; FALLAS=$((FALLAS + 1)); }
  FILAS+=("| $N | $1 | $2 | $3 | $marca |")
}
estado() { curl -s -o /dev/null -w "%{http_code} %{content_type}" --max-time 25 "$BASE$1"; }

# --- 1. Rutas: la lista de permitidos del middleware (bloque S) ---
PERMITIDAS=( "/" "/index.html" "/admin" "/homepage/" "/homepage/locales/es.json" "/homepage/assets/top%20portafolios.png"
             "/sw.js" "/supabase-config.js" "/favicon.png" "/logo_algorithm.svg" "/api/escenarios?symbol=AAPL" )
BLOQUEADAS=( "/schema.sql" "/README.md" "/AGENTS.md" "/docs/lanzamiento/winrate-plan.md" "/docs/lanzamiento/fase-2-migracion.sql"
             "/actualizar_automatico.py" "/montecarlo_engine.py" "/test_montecarlo_synthetic.py" "/.github/workflows/daily_update.yml"
             "/.dev.vars.example" "/wrangler.toml" "/package.json" "/.gitignore" "/homepage/assets/shanghai-hero.jpg.png"
             "/functions/api/news.js" "/no-existe" "/scripts/verificar.sh" "/scripts/qa_navegador.py" )
for p in "${PERMITIDAS[@]}"; do
  r=$(estado "$p"); c=${r%% *}
  if [ "$p" = "/index.html" ]; then ok=0; [ "$c" = 200 ] || [ "$c" = 308 ] && ok=1; fila "Ruta $p" "200 o 308" "$r" "$ok"
  else ok=0; [ "$c" = 200 ] && ok=1; fila "Ruta $p" "200" "$r" "$ok"; fi
done
r=$(estado "/api/admin/check"); ok=0; [ "${r%% *}" = 401 ] && ok=1; fila "Ruta /api/admin/check (sin clave)" "401" "$r" "$ok"
for p in "${BLOQUEADAS[@]}"; do
  r=$(estado "$p"); ok=0; [ "$r" = "404 text/plain; charset=utf-8" ] && ok=1; fila "Ruta $p" "404 text/plain (middleware)" "$r" "$ok"
done

# --- 2. /api/tier-config (bloque 2): 200 JSON, sin ENGINE_PARAMS ni secretos, Free = 5 / 3 / daily ---
r=$(estado "/api/tier-config")
res=$(curl -s --max-time 25 "$BASE/api/tier-config" | "$PY" -c "
import json, re, sys
t = sys.stdin.buffer.read().decode('utf-8', 'replace')
prohibido = len(re.findall(r'patternWindows|chartHistorySessions|newsSensitivity|sensitivityB1|markov|supabase|service_role|anon|secret|key', t, re.I))
try:
    f = json.loads(t)['tiers']['normal']; free = f'{f[\"portfolioAssets\"]}/{f[\"radarSize\"]}/{\",\".join(f[\"patternHorizons\"])}'
except Exception: free = 'ilegible'
print(f'{prohibido}|{free}')")
prohibido=${res%%|*}; free=${res#*|}
ok=0; [ "${r%% *}" = 200 ] && [[ "$r" == *application/json* ]] && [ "$prohibido" = 0 ] && [ "$free" = "5/3/daily" ] && ok=1
fila "/api/tier-config" "200 JSON; 0 ENGINE_PARAMS/secretos; Free 5/3/daily" "$r; prohibidos=$prohibido; Free=$free" "$ok"

# --- 3. /api/market/AAPL y /api/escenarios?symbol=AAPL (bloque 1 y Fase 2) ---
mk=$(curl -s --max-time 30 "$BASE/api/market/AAPL" | "$PY" -c "
import json, sys
try:
    d = json.loads(sys.stdin.buffer.read().decode('utf-8')); ds = d['dates']
    print(f'{len(ds)}|{ds[-1]}|{d[\"close\"][-1]:.2f}|{int(all(a < b for a, b in zip(ds, ds[1:])))}')
except Exception: print('0|?|?|0')")
IFS='|' read -r puntos ultimo cierre asc <<< "$mk"
ok=0; [ "$puntos" = 504 ] && [ "$asc" = 1 ] && ok=1
fila "/api/market/AAPL" "504 puntos, ascendente" "$puntos puntos; último cierre $ultimo ($cierre); ascendente=$asc" "$ok"
es=$(curl -s --max-time 30 "$BASE/api/escenarios?symbol=AAPL" | "$PY" -c "
import json, sys
try:
    h = json.loads(sys.stdin.buffer.read().decode('utf-8'))['horizons']
    print(f'{len(h)}|{h[\"daily\"][\"baseCloseDate\"]}')
except Exception: print('0|?')")
nh=${es%%|*}; base=${es#*|}
ok=0; [ "$nh" = 4 ] && [ "$base" = "$ultimo" ] && ok=1
fila "/api/escenarios?symbol=AAPL" "4 horizontes; baseCloseDate = último cierre" "$nh horizontes; baseCloseDate $base (último cierre $ultimo)" "$ok"

# --- 4. /api/winrate?all=1 sin clave: 401 JSON de la Function (pasa el middleware) ---
r=$(estado "/api/winrate?all=1"); ok=0; [ "${r%% *}" = 401 ] && [[ "$r" == *application/json* ]] && ok=1
fila "/api/winrate?all=1 (sin clave)" "401 application/json" "$r" "$ok"

# --- 5. Huellas de los bloques fusionados (solo cuenta coincidencias; nunca imprime contenido) ---
# Formato: "ruta|descripción|patrón (grep -E)|esperado: >=1 o =0". Al fusionar un bloque nuevo, se agrega una línea.
HUELLAS=(
  "/|S: login de admin verificado en /api/admin/check|api/admin/check|>=1"
  "/|S: sin comparaciones de credenciales en el navegador|\\.value !== '[^']+'|=0"
  "/|Bloque 1: guarda del motor sombra|if\\(!SHOW_SHADOW_ENGINE\\)\\{renderPortfolioChart\\(\\);return;\\}|>=1"
  "/|Bloque 2: límites por nivel (loadTierConfig)|loadTierConfig|>=1"
  "/|Bloque 4: subtítulo del radar \"en la próxima sesión\"|moverse en la próxima sesión|>=1"
  "/|Bloque 4: sin #recalculate|recalculate|=0"
  "/homepage/locales/es.json|Bloque 4: radar es|para la próxima sesión|>=1"
  "/homepage/locales/en.json|Bloque 4: radar en|for the next session|>=1"
  "/homepage/locales/zh.json|Bloque 4: radar zh|下一交易日|>=1"
)
for h in "${HUELLAS[@]}"; do
  IFS='|' read -r ruta desc patron cond <<< "$h"
  n=$(curl -s --max-time 25 "$BASE$ruta" | grep -c -E -- "$patron")
  ok=0; if [ "$cond" = "=0" ]; then [ "$n" = 0 ] && ok=1; else [ "$n" -ge 1 ] && ok=1; fi
  fila "Huella: $desc ($ruta)" "${cond/>=1/≥ 1} coincidencias" "$n" "$ok"
done

# --- Reporte ---
FECHA=$(date +%Y-%m-%d_%H%M%S)
REPORTE=$( {
  echo "# Verificación $OBJETIVO — $FECHA"
  echo; echo "Base: $BASE · solo lectura (curl). M no deja huella en el sitio: se verifica en el log y en Supabase."; echo
  echo "| # | Comprobación | Esperado | Resultado | ✓ |"; echo "|---|---|---|---|---|"
  printf '%s\n' "${FILAS[@]}"
  echo; echo "**$((N - FALLAS))/$N correctas.**"
} )
echo "$REPORTE"
if [ "$GUARDAR" = 1 ]; then
  DIR="$(cd "$(dirname "$0")/.." && pwd)/qa-salida"; mkdir -p "$DIR"
  echo "$REPORTE" > "$DIR/verificar-$OBJETIVO-$FECHA.md"; echo; echo "Guardado en qa-salida/verificar-$OBJETIVO-$FECHA.md"
fi
[ "$FALLAS" = 0 ]
