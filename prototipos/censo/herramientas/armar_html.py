"""Arma la web en UN SOLO archivo HTML (se abre con doble clic, sin internet).

    python3 herramientas/armar_html.py LIBS SEMILLA.json SALIDA.html [ESBUILD]

LIBS: carpeta con react-18.3.1, react-dom-18.3.1, htm-3.1.1 y jspdf-2.5.1 (paquetes npm).
SEMILLA.json: datos iniciales (lo que genera importar_padron.py).
Los datos se guardan en el navegador (herramientas/adaptador_local.js).
"""
import sys, os, json, base64, subprocess

LIBS, SEMILLA, SALIDA = sys.argv[1:4]
ESBUILD = sys.argv[4] if len(sys.argv) > 4 else "esbuild"
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
leer = lambda p: open(p, encoding="utf-8").read()
segura = lambda js: js.replace("</script", "<\\/script")

app = subprocess.run([ESBUILD, os.path.join(RAIZ, "src", "main.js"), "--bundle", "--format=iife", "--minify",
                      "--target=es2020", "--charset=utf8"], capture_output=True, text=True, check=True).stdout
logo = "data:image/jpeg;base64," + base64.b64encode(open(os.path.join(RAIZ, "img", "logo.jpg"), "rb").read()).decode()
app = app.replace('"img/logo.jpg"', json.dumps(logo))

libs = [os.path.join(LIBS, p) for p in ("react-18.3.1/package/umd/react.production.min.js",
        "react-dom-18.3.1/package/umd/react-dom.production.min.js", "htm-3.1.1/package/dist/htm.umd.js",
        "jspdf-2.5.1/package/dist/jspdf.umd.min.js")]
css = leer(os.path.join(RAIZ, "estilos", "tokens.css")) + "\n" + leer(os.path.join(RAIZ, "estilos", "app.css"))
semilla = json.dumps(json.load(open(SEMILLA, encoding="utf-8")), ensure_ascii=False, separators=(",", ":"))

html = f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portal Inmaculada Concepción</title>
<link rel="icon" href="{logo}">
<style>{css}</style>
</head>
<body>
<div id="app"><div class="arranque">Cargando el padrón…</div></div>
{''.join(f'<script>{segura(leer(p))}</script>' for p in libs)}
<script>window.__SEMILLA__ = {segura(semilla)};</script>
<script>{segura(leer(os.path.join(RAIZ, 'herramientas', 'adaptador_local.js')))}</script>
<script>{segura(app)}</script>
</body>
</html>"""
open(SALIDA, "w", encoding="utf-8").write(html)
print(f"{SALIDA}: {len(html) // 1024} KB")
