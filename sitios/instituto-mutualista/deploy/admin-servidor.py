#!/usr/bin/env python3
"""Servicio del panel de administración del sitio del Instituto Mutualista.

Recibe lo que se guarda en el panel (fotos, videos y sitio.json) y lo publica en
/var/lib/instituto/contenido, que Nginx sirve antes que la versión desplegada.
Solo escucha en 127.0.0.1: Nginx le pasa /api/admin/ (con HTTPS y límite de intentos).

Seguridad: contraseña con scrypt en /etc/instituto/admin.json; sesión en cookie
HttpOnly + Secure + SameSite=Strict; los POST exigen la cabecera X-Instituto y un
Origin del propio dominio; bloqueo tras intentos fallidos; los archivos se validan por
su contenido y se guardan con nombres que genera el servidor.
Videos: ffprobe/ffmpeg los dejan en MP4 (H.264 + AAC, máx. 1280 px y 30 s) y sacan la
portada del primer segundo.
"""
import base64, hashlib, hmac, json, os, re, secrets, shutil, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

CONFIG = os.environ.get("INSTITUTO_CONFIG", "/etc/instituto/admin.json")
BASE = os.environ.get("INSTITUTO_DATOS", "/var/lib/instituto")
WEB = os.environ.get("INSTITUTO_WEB", "/var/www/instituto")
PUERTO = int(os.environ.get("INSTITUTO_PUERTO", "8099"))
CONT, TMP, HIST = os.path.join(BASE, "contenido"), os.path.join(BASE, "tmp"), os.path.join(BASE, "historial")
MAX_IMAGEN, MAX_VIDEO, MAX_JSON = 8 << 20, 200 << 20, 2 << 20
MAX_SEG, LADO = 30, 1280
SESION_SEG = 8 * 3600
RUTA_OK = re.compile(r"^(imagenes|portada)/[\w.-]+\.(jpe?g|png|webp)$|^videos/[\w.-]+\.(mp4|webm)$", re.I)

sesiones, fallos, bloqueos, fallos_globales = {}, {}, {}, []
candado, candado_video = threading.Lock(), threading.Lock()


def log(*a):
    print(time.strftime("%F %T"), *a, file=sys.stderr, flush=True)


def leer_config():
    with open(CONFIG, encoding="utf-8") as f:
        return json.load(f)


def hash_clave(clave, sal=None):
    sal = sal or secrets.token_bytes(16)
    h = hashlib.scrypt(clave.encode(), salt=sal, n=2 ** 15, r=8, p=1, maxmem=64 << 20, dklen=32)
    return "scrypt$15$8$1$%s$%s" % (base64.b64encode(sal).decode(), base64.b64encode(h).decode())


def clave_ok(clave, guardado):
    try:
        _, n, r, p, sal, h = guardado.split("$")
        calc = hashlib.scrypt(clave.encode(), salt=base64.b64decode(sal), n=2 ** int(n), r=int(r), p=int(p),
                              maxmem=64 << 20, dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(h))
    except Exception:
        return False


def escribir_atomico(ruta, datos, modo=0o644):
    d = os.path.dirname(ruta)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".nuevo-")
    with os.fdopen(fd, "wb") as f:
        f.write(datos)
    os.chmod(tmp, modo)
    os.replace(tmp, ruta)


def tipo_imagen(cab):
    if cab[:3] == b"\xff\xd8\xff":
        return "jpg"
    if cab[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if cab[:4] == b"RIFF" and cab[8:12] == b"WEBP":
        return "webp"
    return None


def es_video(cab):
    return cab[4:8] == b"ftyp" or cab[:4] == b"\x1a\x45\xdf\xa3"   # MP4/MOV o WebM/Matroska


def prefijo(q):
    p = re.sub(r"[^\w-]", "", (q.get("nombre") or ["x"])[0])[:40]
    return p or "x"


def nombre_libre(carpeta, pref, ext):
    return "%s-%s.%s" % (pref, secrets.token_hex(4), ext)


def sondear(ruta):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", ruta],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise ValueError("No se pudo leer el video. Prueba con un MP4 o MOV de celular.")
    d = json.loads(r.stdout or "{}")
    v = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), None)
    if not v:
        raise ValueError("El archivo no tiene imagen de video.")
    a = next((s for s in d.get("streams", []) if s.get("codec_type") == "audio"), None)
    try:
        dur = float(d.get("format", {}).get("duration") or 0)
    except ValueError:
        dur = 0.0
    return v, a, dur


def procesar_video(origen, destino, poster):
    """Deja el video listo para cualquier navegador y saca la portada. Devuelve (segundos, aviso)."""
    v, a, dur = sondear(origen)
    if dur <= 0:
        raise ValueError("No se pudo saber cuánto dura el video.")
    aviso = ""
    largo = dur > MAX_SEG + 0.5
    if largo:
        aviso = "El video duraba %d s: se publicaron los primeros %d s." % (round(dur), MAX_SEG)
    w, h = int(v.get("width") or 0), int(v.get("height") or 0)
    copiar = (v.get("codec_name") == "h264" and max(w, h) <= LADO and not largo
              and (a is None or a.get("codec_name") == "aac") and os.path.getsize(origen) <= 15 << 20)
    if copiar:   # ya es compatible: solo se reordena para que empiece a verse antes de bajar todo
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", origen, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy",
               "-movflags", "+faststart", destino]
    else:
        escala = "scale='if(gte(iw,ih),min(%d,iw),-2)':'if(gte(iw,ih),-2,min(%d,ih))'" % (LADO, LADO)
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", origen, "-t", str(MAX_SEG), "-map", "0:v:0", "-map", "0:a:0?",
               "-vf", escala, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-profile:v", "main",
               "-pix_fmt", "yuv420p", "-threads", "1", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
               destino]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        log("ffmpeg:", r.stderr[-800:])
        raise ValueError("No se pudo convertir el video. Prueba con otro archivo.")
    _, _, final = sondear(destino)
    momento = "1" if final > 1.5 else "0"
    escala_p = "scale='if(gte(iw,ih),min(%d,iw),-2)':'if(gte(iw,ih),-2,min(%d,ih))'" % (LADO, LADO)
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", momento, "-i", destino, "-frames:v", "1",
                        "-vf", escala_p, "-q:v", "3", poster], capture_output=True, text=True, timeout=120)
    if r.returncode != 0 or not os.path.exists(poster):
        raise ValueError("No se pudo sacar la portada del video.")
    return max(1, round(min(final, MAX_SEG))), aviso


def rutas_en(obj, salida):
    if isinstance(obj, dict):
        for x in obj.values():
            rutas_en(x, salida)
    elif isinstance(obj, list):
        for x in obj:
            rutas_en(x, salida)
    elif isinstance(obj, str) and RUTA_OK.match(obj):
        salida.add(obj)
    return salida


def limpiar(usadas):
    """Borra fotos y videos subidos por el panel que ya nadie usa (con más de 2 h, por si hay un guardado en curso)."""
    limite = time.time() - 7200
    for sub in ("imagenes", "videos"):
        d = os.path.join(CONT, sub)
        for n in os.listdir(d):
            ruta = os.path.join(d, n)
            if "%s/%s" % (sub, n) not in usadas and os.path.isfile(ruta) and os.path.getmtime(ruta) < limite:
                os.remove(ruta)
    hist = sorted(os.listdir(HIST))
    for n in hist[:-30]:
        os.remove(os.path.join(HIST, n))


class Panel(BaseHTTPRequestHandler):
    server_version = "panel"
    sys_version = ""

    def log_message(self, fmt, *args):
        log(self.ip(), fmt % args)

    def ip(self):
        return self.headers.get("X-Real-IP") or self.client_address[0]

    def responder(self, codigo, datos, cookie=None):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def error(self, codigo, msg):
        self.responder(codigo, {"error": msg})

    def token(self):
        for parte in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = parte.strip().partition("=")
            if k == "im_admin":
                return v
        return None

    def con_sesion(self):
        t = self.token()
        with candado:
            fin = sesiones.get(t) if t else None
            if fin and fin > time.time():
                return True
            if t:
                sesiones.pop(t, None)
        return False

    def cookie(self, valor, edad):
        return "im_admin=%s; Path=/api/admin/; Max-Age=%d; HttpOnly; Secure; SameSite=Strict" % (valor, edad)

    def origen_ok(self):
        if self.headers.get("X-Instituto") != "1":
            return False
        origen = self.headers.get("Origin")
        if not origen:
            return True
        try:
            permitidos = leer_config().get("origenes") or []
        except Exception:
            permitidos = []
        return origen in permitidos

    def largo(self, maximo):
        try:
            n = int(self.headers.get("Content-Length") or "-1")
        except ValueError:
            n = -1
        if n < 0:
            self.error(411, "Falta el tamaño del envío.")
            return None
        if n > maximo:
            self.error(413, "El archivo pesa demasiado (máximo %d MB)." % (maximo >> 20))
            return None
        return n

    def leer_json(self, maximo=64 << 10):
        n = self.largo(maximo)
        if n is None:
            return None
        try:
            d = json.loads(self.rfile.read(n) or b"{}")
            return d if isinstance(d, dict) else {}
        except ValueError:
            self.error(400, "Datos no válidos.")
            return None

    def do_GET(self):
        ruta = urlsplit(self.path).path
        if ruta == "/api/admin/estado":
            return self.responder(200, {"servidor": True, "sesion": self.con_sesion()})
        self.error(404, "No existe.")

    def do_POST(self):
        u = urlsplit(self.path)
        ruta, q = u.path, parse_qs(u.query)
        if not self.origen_ok():
            return self.error(403, "Solicitud no permitida.")
        if ruta == "/api/admin/login":
            return self.login()
        if ruta == "/api/admin/salir":
            t = self.token()
            with candado:
                sesiones.pop(t, None)
            return self.responder(200, {"ok": True}, self.cookie("", 0))
        if not self.con_sesion():
            return self.error(401, "La sesión venció. Vuelve a entrar.")
        if ruta == "/api/admin/archivo":
            return self.archivo(q)
        if ruta == "/api/admin/publicar":
            return self.publicar()
        if ruta == "/api/admin/clave":
            return self.cambiar_clave()
        self.error(404, "No existe.")

    def login(self):
        ip, ahora = self.ip(), time.time()
        with candado:
            fallos_globales[:] = [t for t in fallos_globales if t > ahora - 900]
            if bloqueos.get(ip, 0) > ahora or len(fallos_globales) >= 30:
                return self.error(429, "Demasiados intentos. Espera 15 minutos.")
        d = self.leer_json()
        if d is None:
            return
        clave = str(d.get("clave") or "")[:200]
        try:
            ok = bool(clave) and clave_ok(clave, leer_config().get("hash", ""))
        except Exception:
            return self.error(503, "El panel aún no tiene contraseña. Créala en el servidor con: sudo instituto-clave")
        with candado:
            if not ok:
                lista = [t for t in fallos.get(ip, []) if t > ahora - 900] + [ahora]
                fallos[ip] = lista
                fallos_globales.append(ahora)
                if len(lista) >= 5:
                    bloqueos[ip] = ahora + 900
                    fallos.pop(ip, None)
                    log("bloqueo de 15 min para", ip)
                return self.error(401, "Contraseña incorrecta.")
            fallos.pop(ip, None)
            for t in [t for t, fin in sesiones.items() if fin < ahora]:
                sesiones.pop(t, None)
            t = secrets.token_urlsafe(32)
            sesiones[t] = ahora + SESION_SEG
        log("sesión iniciada desde", ip)
        self.responder(200, {"ok": True}, self.cookie(t, SESION_SEG))

    def guardar_cuerpo(self, n, destino):
        resta = n
        with open(destino, "wb") as f:
            while resta > 0:
                trozo = self.rfile.read(min(resta, 1 << 20))
                if not trozo:
                    raise ValueError("El envío llegó incompleto.")
                f.write(trozo)
                resta -= len(trozo)

    def archivo(self, q):
        tipo = (q.get("tipo") or [""])[0]
        if tipo not in ("imagen", "video"):
            return self.error(400, "Tipo de archivo no válido.")
        n = self.largo(MAX_IMAGEN if tipo == "imagen" else MAX_VIDEO)
        if n is None:
            return
        fd, tmp = tempfile.mkstemp(dir=TMP)
        os.close(fd)
        try:
            self.guardar_cuerpo(n, tmp)
            with open(tmp, "rb") as f:
                cab = f.read(16)
            pref = prefijo(q)
            if tipo == "imagen":
                ext = tipo_imagen(cab)
                if not ext:
                    return self.error(400, "La imagen debe ser JPG, PNG o WebP.")
                nombre = nombre_libre(CONT, pref, ext)
                os.chmod(tmp, 0o644)
                os.replace(tmp, os.path.join(CONT, "imagenes", nombre))
                return self.responder(200, {"ruta": "imagenes/" + nombre})
            if not es_video(cab):
                return self.error(400, "El archivo no es un video MP4, MOV o WebM.")
            base = nombre_libre(CONT, pref, "x")[:-2]
            final_v = os.path.join(TMP, base + ".mp4")
            final_p = os.path.join(TMP, base + ".jpg")
            with candado_video:
                segundos, aviso = procesar_video(tmp, final_v, final_p)
            for ruta in (final_v, final_p):
                os.chmod(ruta, 0o644)
            os.replace(final_v, os.path.join(CONT, "videos", base + ".mp4"))
            os.replace(final_p, os.path.join(CONT, "imagenes", base + ".jpg"))
            mb = os.path.getsize(os.path.join(CONT, "videos", base + ".mp4")) / 1048576
            log("video publicado", base, "%.1f MB" % mb, aviso)
            self.responder(200, {"archivo": "videos/%s.mp4" % base, "portada": "imagenes/%s.jpg" % base,
                                 "segundos": segundos, "mb": "%.1f" % mb, "aviso": aviso})
        except ValueError as e:
            self.error(400, str(e))
        except subprocess.TimeoutExpired:
            self.error(500, "El video tardó demasiado en convertirse. Prueba con uno más corto.")
        finally:
            for ruta in (tmp,):
                if os.path.exists(ruta):
                    os.remove(ruta)

    def publicar(self):
        d = self.leer_json(MAX_JSON)
        if d is None:
            return
        sitio = d.get("sitio")
        if not isinstance(sitio, dict) or not isinstance(sitio.get("slides", []), list):
            return self.error(400, "Datos del sitio no válidos.")
        usadas = rutas_en(sitio, set())
        faltan = [r for r in sorted(usadas)
                  if not os.path.isfile(os.path.join(CONT, r)) and not os.path.isfile(os.path.join(WEB, r))]
        if faltan:
            return self.error(400, "Falta subir: " + ", ".join(faltan[:3]))
        datos = json.dumps(sitio, ensure_ascii=False, indent=2).encode()
        actual = os.path.join(CONT, "sitio.json")
        if os.path.exists(actual):
            shutil.copy2(actual, os.path.join(HIST, "sitio-%s.json" % time.strftime("%Y%m%d-%H%M%S")))
        escribir_atomico(actual, datos)
        limpiar(usadas)
        log("sitio publicado (%d bytes, %d archivos)" % (len(datos), len(usadas)))
        self.responder(200, {"ok": True})

    def cambiar_clave(self):
        d = self.leer_json()
        if d is None:
            return
        actual, nueva = str(d.get("actual") or ""), str(d.get("nueva") or "")
        cfg = leer_config()
        if not clave_ok(actual, cfg.get("hash", "")):
            return self.error(401, "La contraseña actual no es correcta.")
        if len(nueva) < 10 or len(nueva) > 200:
            return self.error(400, "La contraseña nueva debe tener de 10 a 200 caracteres.")
        cfg["hash"] = hash_clave(nueva)
        escribir_atomico(CONFIG, json.dumps(cfg, indent=2).encode(), 0o600)
        with candado:
            sesiones.clear()
        log("contraseña cambiada")
        self.responder(200, {"ok": True}, self.cookie("", 0))


def principal():
    if len(sys.argv) > 1 and sys.argv[1] == "--hash":
        print(hash_clave(sys.stdin.readline().rstrip("\n")))
        return
    for d in (os.path.join(CONT, "imagenes"), os.path.join(CONT, "videos"), TMP, HIST):
        os.makedirs(d, exist_ok=True)
    for n in os.listdir(TMP):
        os.remove(os.path.join(TMP, n))
    srv = ThreadingHTTPServer(("127.0.0.1", PUERTO), Panel)
    srv.daemon_threads = True
    log("panel escuchando en 127.0.0.1:%d" % PUERTO)
    srv.serve_forever()


if __name__ == "__main__":
    principal()
