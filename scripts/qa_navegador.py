"""Pruebas del navegador (Playwright) para la terminal y la homepage.

Uso (Git Bash; el entorno vive fuera de OneDrive, ver docs/lanzamiento/fase-3-plan.md, sección QA):
  PY="$LOCALAPPDATA/algo-qa/venv/Scripts/python"
  "$PY" scripts/qa_navegador.py --rama lanzamiento-qa-tools        # Preview (por defecto)
  "$PY" scripts/qa_navegador.py --produccion                       # Producción, solo lectura
  read -rs ALGO_ADMIN_KEY && export ALGO_ADMIN_KEY                 # opcional, no se ve al teclear
  "$PY" scripts/qa_navegador.py --rama lanzamiento-qa-tools --superadmin
  unset ALGO_ADMIN_KEY                                             # borra la clave de la terminal

Qué escribe en Supabase (el Preview usa la base de producción):
  - privacy_consents: 1 fila solo la primera vez contra cada sitio (después lo evita el estado guardado
    en .qa-estado/). En Producción, 0: el POST se intercepta.
  - asset_prediction_audit: 1 fila por cada /api/patterns real (AAPL diario: 1 por corrida). BTC responde
    422 y no escribe. asset_pattern_snapshots: hasta 2 upserts por llamada. En Producción, 0 (interceptado).
  - page_views: 0 (track-view interceptado). asset_news_scores: 0 por defecto (/api/news simulado;
    --con-noticias lo deja pasar, solo en el Preview).
  - Superadmin: 0 escrituras extra (la consulta de patrones se responde con la capturada como invitado).
La clave de superadmin solo se lee de ALGO_ADMIN_KEY: nunca se imprime ni se guarda, y el contexto del
superadmin no guarda estado. No se graban trazas ni video (las trazas guardarían lo que se teclea).
"""

import argparse
import datetime
import json
import os
import pathlib
import re
import sys
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "0")  # Chromium dentro del entorno de QA
from playwright.sync_api import TimeoutError as PWTimeout  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

RAIZ = pathlib.Path(__file__).resolve().parent.parent
QA_NOMBRE = "QA Prueba"
QA_CORREO = "jbrichard27+qa@gmail.com"
SEMILLA_PORTAFOLIO = ["apple", "GOOGL", "AMZN", "NVDA", "META"]  # 5 activos; el 6.º de prueba es MSFT
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
RADAR_HOMEPAGE = {
    "es": "Los 3 activos con mayor rango de movimiento estimado para la próxima sesión.",
    "en": "The 3 assets with the widest estimated move for the next session.",
    "zh": "下一交易日预计波动幅度最大的三项资产。",
}
SIN_HISTORIAL = r"(BTC-USD|%5EGSPC|\^GSPC|EWZ|EWJ)"
CONOCIDOS = [  # (descripción, patrón de URL, estados)
    ("noticias (GDELT)", r"/api/news", {429, 502}),
    ("catálogo sin FMP", r"/api/assets", {503}),
    ("activo sin historial", r"/api/(market/" + SIN_HISTORIAL + r"|escenarios\?symbol=" + SIN_HISTORIAL + r"|patterns\?symbol=" + SIN_HISTORIAL + ")", {404, 422}),
    ("clave incorrecta (prueba)", r"/api/admin/check", {401}),
]


class Reporte:
    def __init__(self):
        self.filas = []

    def agregar(self, comprobacion, resultado, estado):
        self.filas.append((comprobacion, resultado, estado))

    def ok(self, comprobacion, condicion, resultado):
        self.agregar(comprobacion, resultado, "✅" if condicion else "❌")

    def omitido(self, comprobacion, motivo):
        self.agregar(comprobacion, motivo, "⏭")

    @property
    def fallas(self):
        return sum(1 for fila in self.filas if fila[2] == "❌")

    def tabla(self):
        lineas = ["| # | Comprobación | Resultado | ✓ |", "|---|---|---|---|"]
        for i, (comp, res, est) in enumerate(self.filas, 1):
            lineas.append(f"| {i} | {comp} | {str(res).replace('|', '/')} | {est} |")
        return "\n".join(lineas)


class Red:
    """Intercepta y registra las peticiones de un contexto. Nunca registra cabeceras ni cuerpos."""

    def __init__(self, produccion, con_noticias, captura_patrones, fase):
        self.produccion, self.con_noticias, self.fase = produccion, con_noticias, fase
        self.captura = captura_patrones  # (símbolo, horizonte) -> cuerpo JSON de /api/patterns
        self.patrones_reales, self.patrones_respondidos = {}, {}
        self.correlation = 0
        self.consentimientos_reales = 0
        self.interceptadas = []       # escrituras simuladas a propósito (track-view, consentimiento en Producción)
        self.bloqueadas = []          # escrituras no esperadas que se abortaron
        self.urls_simuladas = set()
        self.respuestas_error = []    # (url, estado)
        self.errores_consola = []     # (texto, url)
        self.errores_pagina = []

    @staticmethod
    def _clave_patron(url):
        q = parse_qs(urlparse(url).query)
        return (q.get("symbol", ["?"])[0].upper(), q.get("horizon", ["daily"])[0])

    def manejar(self, route, request):
        url, metodo = request.url, request.method
        ruta = urlparse(url).path
        if "/rest/v1/" in url and metodo != "GET":  # supabase-js directo (un invitado no debería)
            self.bloqueadas.append(f"{metodo} {ruta}")
            return route.abort()
        if ruta.startswith("/cdn-cgi/rum"):  # Cloudflare Web Analytics: no es Supabase; la corrida de QA no cuenta como visita
            self.interceptadas.append("POST /cdn-cgi/rum (analítica de Cloudflare)")
            self.urls_simuladas.add(url)
            return route.fulfill(status=204, body="")
        if ruta == "/api/track-view" and metodo == "POST":
            self.interceptadas.append("POST /api/track-view (page_views)")
            self.urls_simuladas.add(url)
            return route.fulfill(status=200, content_type="application/json", body='{"tracked":true}')
        if ruta == "/api/news" and (self.produccion or not self.con_noticias):
            self.urls_simuladas.add(url)
            return route.fulfill(status=200, content_type="application/json", body='{"articles":[]}')
        if ruta == "/api/correlation":
            self.correlation += 1
        if ruta == "/api/patterns":
            clave = self._clave_patron(url)
            if self.produccion:
                self.urls_simuladas.add(url)
                return route.fulfill(status=503, content_type="application/json", body='{"error":"interceptado por QA (Producción)"}')
            if clave in self.captura and self.fase == "superadmin":
                self.patrones_respondidos[clave] = self.patrones_respondidos.get(clave, 0) + 1
                return route.fulfill(status=200, content_type="application/json", body=self.captura[clave])
            self.patrones_reales[clave] = self.patrones_reales.get(clave, 0) + 1
            return route.continue_()
        if metodo not in ("GET", "HEAD", "OPTIONS"):
            if ruta == "/api/privacy-consent":
                if self.produccion:
                    self.interceptadas.append("POST /api/privacy-consent (privacy_consents)")
                    self.urls_simuladas.add(url)
                    return route.fulfill(status=200, content_type="application/json", body='{"ok":true}')
                self.consentimientos_reales += 1
                return route.continue_()
            self.bloqueadas.append(f"{metodo} {ruta}")
            return route.abort()
        return route.continue_()

    def escuchar(self, page):
        def respuesta(resp):
            if resp.status >= 400 and resp.url not in self.urls_simuladas:
                self.respuestas_error.append((resp.url, resp.status))
            if urlparse(resp.url).path == "/api/patterns" and resp.status == 200 and self.fase == "invitado":
                try:
                    self.captura[self._clave_patron(resp.url)] = resp.text()
                except Exception:  # noqa: BLE001
                    pass

        def consola(msg):
            if msg.type == "error":
                self.errores_consola.append((msg.text[:200], (msg.location or {}).get("url", "")))

        page.on("response", respuesta)
        page.on("console", consola)
        page.on("pageerror", lambda err: self.errores_pagina.append(str(err)[:200]))

    def clasificar(self):
        conocidos, nuevos = {}, []
        for url, estado in self.respuestas_error:
            ruta = url.split("://", 1)[-1].split("/", 1)[-1]
            ruta = "/" + ruta
            etiqueta = next((d for d, patron, estados in CONOCIDOS if re.search(patron, ruta) and estado in estados), None)
            if etiqueta:
                conocidos[f"{etiqueta} ({estado})"] = conocidos.get(f"{etiqueta} ({estado})", 0) + 1
            else:
                nuevos.append(f"HTTP {estado} {ruta[:90]}")
        for texto, url in self.errores_consola:
            if texto.startswith("Failed to load resource"):
                continue  # ya contado como respuesta HTTP (conocida o nueva)
            if "ERR_FAILED" in texto or url in self.urls_simuladas:
                conocidos["interceptado por QA"] = conocidos.get("interceptado por QA", 0) + 1
                continue
            nuevos.append(f"consola: {texto[:120]}")
        nuevos += [f"excepción: {e}" for e in self.errores_pagina]
        return conocidos, nuevos


def texto(page, selector):
    return (page.locator(selector).first.text_content(timeout=5000) or "").strip()


def esperar_texto(page, selector, contiene, timeout=45000):
    page.wait_for_function(
        "([sel, txt]) => { const el = document.querySelector(sel); return !!el && (el.textContent || '').includes(txt); }",
        arg=[selector, contiene], timeout=timeout)


def opciones_patrones(page):
    return page.evaluate("() => Object.fromEntries([...document.querySelectorAll('#pattern-horizon option')].map(o => [o.value, !o.disabled]))")


def captura(page, carpeta, nombre, selector=None):
    destino = carpeta / f"{nombre}.png"
    try:
        if selector:
            page.locator(selector).first.screenshot(path=str(destino))
        else:
            page.screenshot(path=str(destino), full_page=False)
    except Exception:  # noqa: BLE001
        pass


def fase_invitado(context, base, rep, red, carpeta, produccion):
    page = context.new_page()
    red.escuchar(page)
    page.goto(base + "/", wait_until="domcontentloaded")

    # 1. Entrada como invitado (con la semilla del portafolio y la última vista en AAPL)
    page.wait_for_selector("#auth-form", state="visible")
    page.evaluate("""([correo, semilla]) => {
        const ns = correo.toLowerCase();
        localStorage.setItem(`algo_portfolio_v1::${ns}`, JSON.stringify(semilla.map(key => ({ key, weight: 0, goal: '', lastPhase: 'blue' }))));
        localStorage.setItem(`algo_last_view_v1::${ns}`, JSON.stringify({ assetKey: 'apple', predictionHorizon: 'daily', chartRange: '3m' }));
        localStorage.setItem(`algo_onboarding_done_v1::${ns}`, '1');
    }""", [QA_CORREO, SEMILLA_PORTAFOLIO])
    page.fill("#full-name", QA_NOMBRE)
    page.fill("#email", QA_CORREO)
    page.click("#auth-submit")

    # 2. Aviso de privacidad (solo la primera vez contra cada sitio)
    try:
        page.wait_for_selector("#privacy-modal.active", timeout=6000)
        page.check("#privacy-modal-check")
        page.click("#privacy-modal-accept")
        page.wait_for_function("() => !document.getElementById('privacy-modal').classList.contains('active')", timeout=20000)
        rep.agregar("Aviso de privacidad", "aceptado: " + ("POST simulado (Producción, 0 filas)" if produccion else "1 fila en privacy_consents (primera corrida)"), "✅")
    except PWTimeout:
        rep.agregar("Aviso de privacidad", "ya aceptado (estado guardado); sin escritura", "✅")
    page.wait_for_selector("#app:not(.hidden)")

    # 3. Configuración por niveles cargada (bloque 2)
    try:
        page.wait_for_function("() => typeof tierConfig !== 'undefined' && tierConfig !== null", timeout=15000)
        rep.ok("/api/tier-config cargado en la página", True, "tierConfig recibido")
    except PWTimeout:
        rep.ok("/api/tier-config cargado en la página", False, "no llegó en 15 s (se usan los límites de Free)")

    # 4. AAPL: último precio = último cierre de /api/market/AAPL y "Datos al cierre del …"
    mercado = page.request.get(base + "/api/market/AAPL").json()
    ultima_fecha, ultimo_cierre = mercado["dates"][-1], float(mercado["close"][-1])
    try:
        esperar_texto(page, "#mc-asof", "Datos al cierre del")
        precio = texto(page, "#last-price")
        numero = float(re.sub(r"[^\d.]", "", precio.replace(",", "")) or "nan")
        rep.ok("AAPL: último precio = último cierre", abs(numero - ultimo_cierre) < 0.006, f"{precio} contra {ultimo_cierre:.2f} ({ultima_fecha})")
        anio, mes, dia = ultima_fecha.split("-")
        esperado = f"{int(dia)}-{MESES[int(mes) - 1]}"
        asof = texto(page, "#mc-asof")
        rep.ok("AAPL: \"Datos al cierre del …\" con la fecha del último cierre", esperado in asof, asof)
    except PWTimeout:
        rep.ok("AAPL: \"Datos al cierre del …\"", False, "no apareció en 45 s")
    captura(page, carpeta, "01-aapl", "#portfolio")

    # 5. Contador y tope del plan Free
    try:
        esperar_texto(page, "#portfolio-weight-total", "5/5 activos (Free)", timeout=15000)
        rep.ok("Contador del portafolio", True, texto(page, "#portfolio-weight-total"))
    except PWTimeout:
        rep.ok("Contador del portafolio", False, texto(page, "#portfolio-weight-total"))
    antes = sum(red.patrones_reales.values())
    page.select_option("#portfolio-asset", "MSFT")
    page.click("#portfolio-add")
    try:
        esperar_texto(page, "#toast", "El plan Free permite monitorear hasta 5 activos", timeout=4000)
        rep.ok("6.º activo bloqueado (Free)", True, texto(page, "#toast"))
    except PWTimeout:
        rep.ok("6.º activo bloqueado (Free)", False, texto(page, "#toast") or "sin aviso")
    captura(page, carpeta, "02-tope-free")
    page.wait_for_timeout(1500)
    rep.ok("El 6.º activo no dispara /api/patterns", sum(red.patrones_reales.values()) == antes, f"{sum(red.patrones_reales.values()) - antes} llamadas nuevas")

    # 6. Patrones: horizontes Free y datos
    ops = opciones_patrones(page)
    rep.ok("Patrones (Free): solo \"Día siguiente\"", ops == {"daily": True, "weekly": False, "monthly": False}, ops)
    if produccion:
        rep.omitido("Patrones: tabla con datos del servidor", "omitido en Producción (/api/patterns interceptado)")
    else:
        filas = page.locator("#pattern-body tr").count()
        rep.ok("Patrones: tabla con datos", filas >= 1, f"{filas} filas")
    captura(page, carpeta, "03-patrones", "#pattern-panel")

    # 7. Radar y tour
    try:
        page.wait_for_function("() => document.querySelectorAll('#top-picks-body tr').length > 0", timeout=60000)
        n = page.locator("#top-picks-body tr").count()
        rep.ok("Radar con 3 filas", n == 3, f"{n} filas")
    except PWTimeout:
        rep.ok("Radar con 3 filas", False, "sin filas en 60 s")
    subtitulo = texto(page, "#top-picks p.subtle")
    rep.ok("Subtítulo del radar: \"en la próxima sesión\"", "moverse en la próxima sesión" in subtitulo, subtitulo[:90])
    captura(page, carpeta, "04-radar", "#top-picks")
    pasos = page.evaluate("() => TOUR_STEPS.map(s => [s.anchor, s.text])")
    radar = next((t for a, t in pasos if a == "#top-picks"), "")
    rep.ok("Tour (paso del radar): \"para la próxima sesión\"", "para la próxima sesión" in radar, radar[:90])
    rep.ok("Tour: ningún paso dice \"mañana\"", not any("mañana" in t for _, t in pasos), f"{len(pasos)} pasos revisados")

    # 8. Bitcoin: sin historial y sin la gráfica anterior
    page.select_option("#asset-select", "btc")
    try:
        esperar_texto(page, "#portfolio-focus", "Aún no hay historial", timeout=30000)
        sin_grafica = page.evaluate("() => portfolioChart === null")
        rep.ok("Bitcoin: \"Aún no hay historial…\" sin la gráfica de AAPL", sin_grafica, f"{texto(page, '#portfolio-focus')[:60]} · gráfica destruida={sin_grafica}")
    except PWTimeout:
        rep.ok("Bitcoin: \"Aún no hay historial…\"", False, texto(page, "#portfolio-focus")[:80])
    rep.ok("Bitcoin: último precio \"—\"", texto(page, "#last-price") == "—", texto(page, "#last-price"))
    captura(page, carpeta, "05-bitcoin", "#portfolio")
    page.wait_for_timeout(1500)

    # 9. Homepage en es/en/zh (una sola carga; cambia de idioma en la página)
    page.goto(base + "/homepage/", wait_until="domcontentloaded")
    for lang, esperado in RADAR_HOMEPAGE.items():
        try:
            page.click("#langButton")
            page.click(f".lang-option[data-lang='{lang}']")
            esperar_texto(page, "[data-i18n='attributes.5.desc']", esperado, timeout=10000)
            rep.ok(f"Homepage ({lang}): radar", True, esperado)
        except PWTimeout:
            rep.ok(f"Homepage ({lang}): radar", False, texto(page, "[data-i18n='attributes.5.desc']")[:90])
        captura(page, carpeta, f"06-homepage-{lang}", "[data-i18n='attributes.5.desc']")
    page.close()


def fase_superadmin(context, base, rep, red, clave):
    page = context.new_page()
    red.escuchar(page)
    page.goto(base + "/", wait_until="domcontentloaded")
    page.wait_for_selector("#auth-form", state="visible")
    page.keyboard.press("Control+Shift+A")
    page.wait_for_selector("#admin-login-modal:not(.hidden)")
    page.fill("#admin-password", "clave-incorrecta-qa")
    page.click("#admin-go")
    try:
        esperar_texto(page, "#admin-error", "Clave incorrecta.", timeout=15000)
        rep.ok("Superadmin: clave incorrecta rechazada", True, "\"Clave incorrecta.\" (401)")
    except PWTimeout:
        rep.ok("Superadmin: clave incorrecta rechazada", False, texto(page, "#admin-error")[:60])
    page.fill("#admin-password", clave)
    page.click("#admin-go")
    page.wait_for_selector("body.superadmin-active", timeout=20000)
    rep.ok("Superadmin: la clave de ALGO_ADMIN_KEY entra", True, "sesión de superadmin activa")
    esperados = {
        "elite": (r"^\d+/12 activos$", {"daily": True, "weekly": True, "monthly": True}),
        "premium": (r"^\d+/12 activos$", {"daily": True, "weekly": True, "monthly": False}),
        "normal": (r"^\d+/5 activos \(Free\)$", {"daily": True, "weekly": False, "monthly": False}),
    }
    for nivel in ("elite", "premium", "normal", "elite"):
        page.click(f".dev-tier-btn[data-tier='{nivel}']")
        page.wait_for_timeout(800)
        patron, horizontes = esperados[nivel]
        contador = texto(page, "#portfolio-weight-total")
        ops = opciones_patrones(page)
        rep.ok(f"Superadmin {nivel.upper()}: contador y horizontes", bool(re.match(patron, contador)) and ops == horizontes, f"{contador} · {ops}")
    n = page.locator("#top-picks-body tr").count()
    rep.ok("Superadmin: radar sigue en 3 filas", n == 3, f"{n} filas")
    page.click("#admin-dashboard-entry")
    try:
        page.wait_for_function("() => /\\d/.test(document.getElementById('winrate-shadow-value')?.textContent || '')", timeout=90000)
        rep.ok("Superadmin: MOTOR SOMBRA (v2) muestra un valor", True, texto(page, "#winrate-shadow-value"))
    except PWTimeout:
        rep.ok("Superadmin: MOTOR SOMBRA (v2) muestra un valor", False, texto(page, "#winrate-shadow-value") or "sin valor en 90 s")
    page.close()


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser(description="Pruebas del navegador (Playwright).")
    ap.add_argument("--rama", help="Rama del Preview (https://<rama>.algorithm-global-engine.pages.dev)")
    ap.add_argument("--produccion", action="store_true", help="Contra https://thalgorithm.com, solo lectura")
    ap.add_argument("--superadmin", action="store_true", help="Prueba el modo superadmin con ALGO_ADMIN_KEY")
    ap.add_argument("--con-noticias", action="store_true", help="Deja pasar /api/news (solo Preview; puede escribir asset_news_scores)")
    ap.add_argument("--ver", action="store_true", help="Muestra el navegador (por defecto, sin ventana)")
    args = ap.parse_args()
    if args.produccion == bool(args.rama):
        ap.error("Indica --rama <rama> (Preview) o --produccion.")
    if args.produccion and args.con_noticias:
        ap.error("--con-noticias solo se permite en el Preview.")
    base = "https://thalgorithm.com" if args.produccion else f"https://{args.rama}.algorithm-global-engine.pages.dev"
    objetivo = "produccion" if args.produccion else f"preview-{args.rama}"
    host = urlparse(base).netloc
    fecha = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    carpeta = RAIZ / "qa-salida" / f"navegador-{objetivo}-{fecha}"
    carpeta.mkdir(parents=True, exist_ok=True)
    estado = RAIZ / ".qa-estado" / f"{host}.json"
    estado.parent.mkdir(parents=True, exist_ok=True)
    clave = os.environ.get("ALGO_ADMIN_KEY", "") if args.superadmin else ""

    rep, captura_patrones = Reporte(), {}
    red_inv = Red(args.produccion, args.con_noticias, captura_patrones, "invitado")
    red_adm = Red(args.produccion, args.con_noticias, captura_patrones, "superadmin")
    inicio = datetime.datetime.now()
    with sync_playwright() as pw:
        navegador = pw.chromium.launch(headless=not args.ver)
        ctx = navegador.new_context(storage_state=str(estado) if estado.exists() else None, locale="es-MX",
                                    viewport={"width": 1440, "height": 1000})
        ctx.set_default_timeout(45000)
        ctx.route("**/*", red_inv.manejar)
        try:
            fase_invitado(ctx, base, rep, red_inv, carpeta, args.produccion)
        except Exception as error:  # noqa: BLE001
            rep.agregar("Fase de invitado", f"se detuvo: {type(error).__name__}: {str(error)[:160]}", "❌")
        ctx.storage_state(path=str(estado))
        ctx.close()

        if args.superadmin and not clave:
            rep.omitido("Superadmin", "omitido: ALGO_ADMIN_KEY no está definida en la terminal")
        elif args.superadmin:
            ctx = navegador.new_context(locale="es-MX", viewport={"width": 1440, "height": 1000})  # sin estado guardado
            ctx.set_default_timeout(45000)
            ctx.route("**/*", red_adm.manejar)
            try:
                fase_superadmin(ctx, base, rep, red_adm, clave)
            except Exception as error:  # noqa: BLE001
                detalle = f"{type(error).__name__}: {str(error)[:160]}".replace(clave, "«oculta»")
                rep.agregar("Fase de superadmin", f"se detuvo: {detalle}", "❌")
            ctx.close()  # nunca se guarda el estado del superadmin
        navegador.close()

    # Red: correlación, patrones una vez por activo, escrituras
    redes = [red_inv] + ([red_adm] if args.superadmin and clave else [])
    rep.ok("Ninguna llamada a /api/correlation", sum(r.correlation for r in redes) == 0, f"{sum(r.correlation for r in redes)} llamadas")
    reales = {}
    for r in redes:
        for k, v in r.patrones_reales.items():
            reales[k] = reales.get(k, 0) + v
    if args.produccion:
        rep.omitido("/api/patterns una vez por activo", "omitido en Producción (interceptado)")
    else:
        rep.ok("/api/patterns como máximo una vez por activo y horizonte", all(v <= 1 for v in reales.values()),
               ", ".join(f"{s} {h}: {v}" for (s, h), v in sorted(reales.items())) or "ninguna")
    bloqueadas = [b for r in redes for b in r.bloqueadas]
    rep.ok("Sin escrituras inesperadas", not bloqueadas, ", ".join(bloqueadas) or "ninguna")
    conocidos, nuevos = {}, []
    for r in redes:
        c, n = r.clasificar()
        for k, v in c.items():
            conocidos[k] = conocidos.get(k, 0) + v
        nuevos += n
    rep.agregar("Errores conocidos", "; ".join(f"{k}: {v}" for k, v in sorted(conocidos.items())) or "ninguno", "ℹ")
    rep.ok("Errores nuevos (consola y HTTP)", not nuevos, "; ".join(nuevos[:8]) or "ninguno")

    escrituras = [
        f"privacy_consents: {sum(r.consentimientos_reales for r in redes)} fila(s)",
        f"asset_prediction_audit: {sum(reales.values()) if not args.produccion else 0} fila(s) (1 por /api/patterns real) y hasta el doble de upserts en asset_pattern_snapshots",
        "page_views: 0 (track-view interceptado)",
        "asset_news_scores: " + ("posible (--con-noticias)" if args.con_noticias else "0 (/api/news simulado)"),
    ]
    duracion = (datetime.datetime.now() - inicio).seconds
    reporte = "\n".join([
        f"# QA del navegador — {objetivo} — {fecha}", "",
        f"Base: {base} · {'solo lectura (escrituras interceptadas)' if args.produccion else 'Preview (escribe en la base de producción)'} · {duracion} s", "",
        rep.tabla(), "",
        "**Escrituras en Supabase de esta corrida:** " + "; ".join(escrituras) + ".",
        "", f"**{sum(1 for f in rep.filas if f[2] == '✅')} ✅ · {rep.fallas} ❌ · {sum(1 for f in rep.filas if f[2] == '⏭')} omitidas.** Capturas en esta carpeta.",
    ])
    (carpeta / "reporte.md").write_text(reporte, encoding="utf-8")
    print(reporte)
    print(f"\nReporte y capturas: {carpeta.relative_to(RAIZ)}")
    sys.exit(1 if rep.fallas else 0)


if __name__ == "__main__":
    main()
