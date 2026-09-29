"""Calca el plano real del C.C. desde el PDF vectorial (Mapa de riesgo MR-01) y
escribe src/plano.js. Uso:

    pip install pymupdf shapely
    python3 herramientas/calcar_plano.py ruta/al/MAPA_DE_RIESGO.pdf

Cómo funciona:
  1. Cada número de stand (1001…1405) es un texto del PDF: da el código y el punto.
  2. Todas las líneas del dibujo se cortan entre sí y se convierten en caras
     (polygonize). Las caras chicas unidas forman los bloques de stands.
  3. Cada bloque se reparte entre sus números (Voronoi) → un polígono por stand.
  4. La galería sale de la letra (A…M) más cercana al bloque; los perímetros
     M, K y L se fijan por rango de números (RANGOS abajo, ajustable).
  5. El resto del dibujo (muros, SS.HH., escaleras) queda como fondo.
"""
import sys, re, math, json, statistics
import pymupdf as fitz
from shapely.geometry import LineString, Point, MultiPoint, Polygon, box
from shapely.ops import polygonize, unary_union, voronoi_diagram, polylabel
from shapely.prepared import prep
from shapely.strtree import STRtree

PDF = sys.argv[1]
SALIDA = sys.argv[2] if len(sys.argv) > 2 else "src/plano.js"

# Galerías del perímetro que no se deducen bien por la letra más cercana.
RANGOS = [("M", 1001, 1015), ("K", 1016, 1042), ("L", 1043, 1063), ("L", 1396, 1405)]
# Zonas del PDF que no son el plano (cajetín, leyenda, título, muestras).
FUERA = [box(2150, 0, 2384, 1684), box(80, 1110, 735, 1684), box(0, 0, 2384, 75),
         box(740, 1530, 990, 1615), box(140, 905, 215, 985), box(1045, 1585, 1115, 1660)]
RECORTE = (30, 70, 2140, 1665)  # x0, y0, x1, y1 del área útil

pag = fitz.open(PDF)[0]
M = pag.rotation_matrix

# 1) Números de stand
nums = {}
for w in pag.get_text("words"):
    if re.fullmatch(r"1\d{3}[A-Z]?", w[4]):
        c = fitz.Point((w[0] + w[2]) / 2, (w[1] + w[3]) / 2) * M
        nums[re.match(r"\d+", w[4]).group()] = (c.x, c.y)
# Correcciones de rótulos mal ubicados en el PDF (coordenadas de la página girada):
# el "1032" está escrito sobre la línea entre 1035 y 1036; por numeración corrida
# es la celda sin número entre 1031 y 1033.
CORRECCIONES = {"1032": (1290, 1255)}
nums.update(CORRECCIONES)
letras = []
for w in pag.get_text("words"):
    if re.fullmatch(r"[A-M]", w[4]):
        c = fitz.Point((w[0] + w[2]) / 2, (w[1] + w[3]) / 2) * M
        if not any(z.contains(Point(c.x, c.y)) for z in FUERA) and max(w[2] - w[0], w[3] - w[1]) > 9:
            letras.append((w[4], c.x, c.y))

# 2) Líneas → caras
dibujos = pag.get_drawings()
lineas = []
for g in dibujos:
    if g["type"] != "s":
        continue
    for it in g["items"]:
        if it[0] == "l":
            a, b = it[1] * M, it[2] * M
            if math.hypot(b.x - a.x, b.y - a.y) > 0.3:
                lineas.append(LineString([(a.x, a.y), (b.x, b.y)]))
caras = list(polygonize(unary_union(lineas)))

# 3) Bloques y celdas
bloques = unary_union([f.buffer(0.6) for f in caras if f.area < 4500]).buffer(-0.6)
bloques = list(getattr(bloques, "geoms", [bloques]))
puntos = {k: Point(v) for k, v in nums.items()}
celdas = {}
for b in bloques:
    dentro = [k for k, pt in puntos.items() if b.contains(pt)]
    if not dentro:
        continue
    b = Polygon(b.exterior)
    if len(dentro) == 1:
        celdas[dentro[0]] = b
        continue
    vd = voronoi_diagram(MultiPoint([puntos[k] for k in dentro]), envelope=b.envelope.buffer(50))
    for cel in vd.geoms:
        k = next(k for k in dentro if cel.contains(puntos[k]))
        celdas[k] = cel.intersection(b)
mediana = statistics.median(c.area for c in celdas.values())
# Stand solo en su bloque pero enorme (p. ej. 1396, que se "comía" la rampa de salida):
# si sus dos vecinos de numeración siguen en fila, se repite el paso de la fila;
# si no, se usa la cara más chica del dibujo que contiene su número.
from shapely.affinity import translate
for k in list(celdas):
    if celdas[k].area <= 2.5 * mediana:
        continue
    n = int(k)
    for a, b in ((str(n + 1), str(n + 2)), (str(n - 1), str(n - 2))):
        if a in celdas and b in celdas and celdas[a].distance(celdas[b]) < 2:
            ca, cb = celdas[a].centroid, celdas[b].centroid
            celdas[k] = translate(celdas[a], ca.x - cb.x, ca.y - cb.y).difference(celdas[a])
            break
    else:
        propias = sorted((f for f in caras if f.contains(puntos[k]) and f.area > 150), key=lambda f: f.area)
        if propias:
            celdas[k] = propias[0]
# Sin celda en el dibujo (p. ej. 1022): se reparte con el stand vecino que ocupó su lugar.
for k, (x, y) in nums.items():
    if k in celdas:
        continue
    caja = box(x - 14, y - 11, x + 14, y + 11)
    vecino = min(celdas, key=lambda j: celdas[j].distance(puntos[k]))
    if celdas[vecino].distance(puntos[k]) < 15:
        zona = unary_union([celdas[vecino], caja]) if not celdas[vecino].contains(puntos[k]) else celdas[vecino]
        vd = voronoi_diagram(MultiPoint([puntos[k], puntos[vecino]]), envelope=zona.envelope.buffer(50))
        for cel in vd.geoms:
            parte = cel.intersection(zona)
            if cel.contains(puntos[k]):
                celdas[k] = parte
            else:
                celdas[vecino] = parte
    else:
        celdas[k] = caja

def mayor(g):
    gs = [q for q in getattr(g, "geoms", [g]) if q.geom_type == "Polygon"]
    return max(gs, key=lambda q: q.area)
celdas = {k: mayor(v).simplify(0.6) for k, v in celdas.items()}

# 4) Galería por bloque (celdas que se tocan) y rangos del perímetro
ks = list(celdas); padre = {k: k for k in ks}
def raiz(k):
    while padre[k] != k:
        padre[k] = padre[padre[k]]; k = padre[k]
    return k
geoms = [celdas[k].buffer(0.8) for k in ks]; arbol = STRtree(geoms)
for i, g in enumerate(geoms):
    for j in arbol.query(g):
        if j > i and g.intersects(geoms[j]):
            padre[raiz(ks[i])] = raiz(ks[j])
grupos = {}
for k in ks:
    grupos.setdefault(raiz(k), []).append(k)
galeria = {}
for miembros in grupos.values():
    u = unary_union([celdas[k] for k in miembros])
    letra = min(letras, key=lambda l: u.distance(Point(l[1], l[2])))[0]
    for k in miembros:
        galeria[k] = letra
for letra, a, b in RANGOS:
    for k in ks:
        if a <= int(k) <= b:
            galeria[k] = letra

# 5) Fondo: todo lo que no es stand ni leyenda
ocupado = unary_union([c.buffer(0.6) for c in celdas.values()])
# Señales "S" (círculos amarillos a rayas) y sus marcos: no son parte del plano.
senales = unary_union([box(*tuple(g["rect"] * M)).buffer(10) for g in dibujos
                       if g.get("fill") and abs(g["fill"][0] - 1) < 0.02 and abs(g["fill"][1] - 0.75) < 0.02 and g["fill"][2] < 0.02])
fuera = prep(unary_union(FUERA + [senales]))
recorte = box(*RECORTE)
def es_senal(g):  # rombos "S" de señalización y flechas de evacuación
    r = g["rect"] * M
    if 20 < r.width < 80 and abs(r.width - r.height) < 8:
        angs = [math.degrees(math.atan2((it[2] * M).y - (it[1] * M).y, (it[2] * M).x - (it[1] * M).x)) % 90
                for it in g["items"] if it[0] == "l"]
        if angs and all(35 < a < 55 for a in angs):
            return True
    return r.width < 14 and r.height < 14
tramos = []
for g in dibujos:
    if g["type"] != "s" or es_senal(g):
        continue
    for it in g["items"]:
        if it[0] == "l":
            pts = [it[1] * M, it[2] * M]
        elif it[0] == "c":
            pts = [it[1] * M, it[4] * M]
        elif it[0] == "re":
            r = it[1] * M
            pts = [fitz.Point(r.x0, r.y0), fitz.Point(r.x1, r.y0), fitz.Point(r.x1, r.y1), fitz.Point(r.x0, r.y1), fitz.Point(r.x0, r.y0)]
        else:
            continue
        for a, b in zip(pts, pts[1:]):
            s = LineString([(a.x, a.y), (b.x, b.y)])
            if s.length < 0.8 or fuera.contains(s.centroid) or not recorte.contains(s.centroid):
                continue
            giro = math.degrees(math.atan2(b.y - a.y, b.x - a.x)) % 90
            if 38 < giro < 52 and 15 < s.length < 75:  # lados de los rombos "S" (señalización)
                continue
            resto = s.difference(ocupado)
            for q in getattr(resto, "geoms", [resto]):
                if q.geom_type == "LineString" and q.length > 1.5:
                    tramos.append(list(q.coords))

X0, Y0 = RECORTE[0], RECORTE[1]
f = lambda v: f"{v:.1f}".rstrip("0").rstrip(".")
def pt(x, y):
    return f"{f(x - X0)},{f(y - Y0)}"
# une tramos consecutivos en un solo "path"
d = []; ultimo = None
for t in tramos:
    ini = pt(*t[0])
    if ini != ultimo:
        d.append("M" + ini)
    d.append("L" + " ".join(pt(*c) for c in t[1:]))
    ultimo = pt(*t[-1])
fondo = "".join(d)

# Rótulos (pasajes, calles, ambientes) con su giro
rotulos = []
for bl in pag.get_text("dict")["blocks"]:
    for ln in bl.get("lines", []):
        t = " ".join(s["text"] for s in ln["spans"]).strip()
        if not re.search(r"PASAJE|JR\.|SS\.HH|GRUTA|SALIDA G|PROPIEDAD|TERCEROS|LIMPIEZA|PERSONAL", t):
            continue
        r = fitz.Rect(ln["bbox"]) * M
        v = fitz.Point(*ln["dir"]) * fitz.Matrix(M.a, M.b, M.c, M.d, 0, 0)
        giro = round(math.degrees(math.atan2(v.y, v.x)), 1)
        tipo = "calle" if t.startswith("JR.") else "pasaje" if t.startswith("PASAJE") else "ambiente"
        texto = {"SS.HH-CABALLEROS": "SS.HH. Caballeros", "SS.HH-DAMAS": "SS.HH. Damas", "JR.AMAZONAS": "Jr. Amazonas",
                 "JR.ANDAHUAYLAS": "Jr. Andahuaylas", "JR.AYACUCHO": "Jr. Ayacucho", "DEP. LIMPIEZA": "Dep. limpieza (2.º nivel)",
                 "CTO.PERSONAL": "Cto. personal (2.º nivel)", "GRUTA": "Gruta", "SALIDA G": "Salida G",
                 "PROPIEDAD DE": "Propiedad de terceros", "TERCEROS": ""}.get(t, t.replace("PASAJE ", "Pasaje ").replace("N°", "N.º ").replace("CENTRAL", "central").replace("AMAZONAS", "Amazonas").replace("AYACUCHO", "Ayacucho"))
        if not texto or (tipo == "calle" and abs(giro) < 1 and "ANDAHUAYLAS" in t):
            continue
        rotulos.append({"texto": texto, "x": round((r.x0 + r.x1) / 2 - X0, 1), "y": round((r.y0 + r.y1) / 2 - Y0, 1), "giro": giro, "tipo": tipo})

# Letra de galería: una por bloque, en el extremo del bloque (fuera de los stands)
PERIMETRO = {"M", "K", "L"}
centro = unary_union(list(celdas.values())).centroid
def despejar(px, py, dx, dy, minimo=13):
    """Corre el punto en la dirección (dx, dy) hasta que no pise ningún stand."""
    n = math.hypot(dx, dy) or 1
    for _ in range(60):
        if ocupado.distance(Point(px, py)) >= minimo:
            break
        px, py = px + dx / n * 2, py + dy / n * 2
    return px, py
etiquetas = []
# Perímetro (M, K, L): la letra del PDF, llevada hacia el pasillo interior.
for letra, lx, ly in letras:
    if letra in PERIMETRO:
        px, py = despejar(lx, ly, centro.x - lx, centro.y - ly)
        etiquetas.append({"galeria": letra, "x": round(px - X0, 1), "y": round(py - Y0, 1)})
for miembros in grupos.values():
    if len(miembros) < 3 or galeria[miembros[0]] in PERIMETRO:
        continue
    u = unary_union([celdas[k] for k in miembros])
    rect = u.minimum_rotated_rectangle
    cs = list(rect.exterior.coords)[:4]
    lados = sorted([(cs[i], cs[(i + 1) % 4]) for i in range(4)], key=lambda s: math.dist(*s))
    extremos = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in lados[:2]]
    cx, cy = rect.centroid.x, rect.centroid.y
    opciones = []
    for ex, ey in extremos:
        dx, dy = ex - cx, ey - cy; n = math.hypot(dx, dy) or 1
        px, py = ex + dx / n * 17, ey + dy / n * 17
        opciones.append((ocupado.distance(Point(px, py)), px, py))
    _, px, py = max(opciones)  # el extremo más despejado
    px, py = despejar(px, py, px - cx, py - cy)
    etiquetas.append({"galeria": galeria[miembros[0]], "x": round(px - X0, 1), "y": round(py - Y0, 1)})

# Salidas de emergencia: rectángulos verdes "SALIDA" del PDF (sin la leyenda).
# Vienen partidos en triángulos: se juntan las piezas que se tocan.
piezas = []
for g in dibujos:
    f_ = g.get("fill")
    if not f_ or not (f_[1] > 0.8 and f_[0] < 0.1 and f_[2] < 0.1):
        continue
    r = g["rect"] * M
    if r.width * r.height < 300 or fuera.contains(Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)):
        continue
    pts_ = [((q * M).x, (q * M).y) for it in g["items"] for q in it[1:] if isinstance(q, fitz.Point)]
    if len(pts_) >= 3:
        piezas.append(MultiPoint(pts_).convex_hull)
salidas = [g.convex_hull for g in getattr(unary_union([q.buffer(1) for q in piezas]), "geoms", [unary_union([q.buffer(1) for q in piezas])])]
salidas = [g.buffer(-1, join_style=2).minimum_rotated_rectangle for g in salidas]

def poli(g):
    return " ".join(pt(x, y) for x, y in list(g.exterior.coords)[:-1])
stands = []
for k in sorted(celdas, key=int):
    g = celdas[k]
    c = polylabel(g, 0.5) if g.area > 50 else g.centroid
    stands.append([k, galeria[k], poli(g), round(c.x - X0, 1), round(c.y - Y0, 1)])

ancho, alto = RECORTE[2] - RECORTE[0], RECORTE[3] - RECORTE[1]
js = f"""// Plano REAL del C.C. "Inmaculada Concepción" — un solo piso (1er nivel).
// Calcado del Mapa de riesgo MR-01 (Jorge Romero Vargas, agosto 2025)
// con herramientas/calcar_plano.py. NO editar a mano: si cambia el plano,
// se vuelve a correr el script con el PDF nuevo.
//
// stands:    [código, galería, "x,y x,y …" (polígono), x del número, y del número]
// fondo:     muros, SS.HH., escaleras y veredas (un solo trazo SVG)
// rotulos:   pasajes, calles y ambientes, con su giro en grados
// salidas:   salidas de emergencia (polígonos verdes del mapa de riesgo)
// etiquetas: letra de cada bloque de galería
export const PLANO = {json.dumps({"ancho": ancho, "alto": alto, "fuente": "Mapa de riesgo MR-01 · agosto 2025",
    "stands": stands, "salidas": [poli(g) for g in salidas], "rotulos": rotulos, "etiquetas": etiquetas, "fondo": fondo}, ensure_ascii=False, separators=(",", ":"))};
"""
open(SALIDA, "w").write(js)
print(f"{len(salidas)} salidas · {len(stands)} stands · {len(rotulos)} rótulos · {len(etiquetas)} etiquetas · {len(js)//1024} KB → {SALIDA}")
from collections import Counter
print(sorted(Counter(galeria.values()).items()))
