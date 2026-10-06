// Consulta de DNI vía apidni.com (misma lógica que src/lib/reniec.ts de Radar),
// con caché en disco para no gastar dos veces la misma consulta.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const txt = (v) => String(v ?? "").trim();
const fechaISO = (v) => {
  const t = txt(v);
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);             // AAAA-MM-DD (ISO)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);   // DD-MM-AAAA o DD/MM/AAAA
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);                   // AAAAMMDD
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
};
const fotoLimpia = (v) => {
  const s = txt(v).replace(/^data:image\/\w+;base64,/, "").replace(/\s+/g, "");
  return s.length > 100 && /^[A-Za-z0-9+/=]+$/.test(s) ? s : "";
};
function clasificar(mensaje) {
  const m = mensaje.toLowerCase();
  if (m.includes("expirado")) return 401;
  if (m.includes("superó") || m.includes("límite") || m.includes("limite")) return 429;
  if (m.includes("longitud")) return 400;
  if (m.includes("error en la consulta")) return 404;
  return 502;
}

/** Busca la primera clave presente (insensible a mayúsculas, guiones y guiones bajos). */
function campo(o, ...nombres) {
  if (!o || typeof o !== "object") return undefined;
  const plano = Object.fromEntries(Object.keys(o).map((k) => [k.toLowerCase().replace(/[_\-\s]/g, ""), o[k]]));
  for (const n of nombres) { const v = plano[n.toLowerCase().replace(/[_\-\s]/g, "")]; if (v !== undefined && v !== null && v !== "") return v; }
  return undefined;
}

/**
 * Convierte la respuesta de distintos proveedores (apidni.com, go.net.pe y similares) a PersonaReniec.
 * Acepta los datos en `data`, `result`, `resultado`, `persona` o en la raíz; nombres de campo en
 * español/inglés, con o sin guion bajo. Devuelve null si no hay persona.
 */
export function normalizar(j, dniPedido) {
  if (!j || typeof j !== "object") return null;
  const d = campo(j, "data", "result", "resultado", "persona", "datos") ?? j;
  if (!d || typeof d !== "object") return null;
  const exito = campo(j, "success", "ok", "exito", "estado");
  const codigo = campo(j, "codigo", "code");
  if (exito === false || exito === "false" || exito === 0 || (codigo !== undefined && !(Number(codigo) > 0) && !campo(d, "nombres", "nombre", "first_name"))) return null;
  const nombres = txt(campo(d, "nombres", "nombre", "first_name", "names", "prenombres"));
  const dni = txt(campo(d, "dni", "numero", "num_doc", "numeroDocumento", "documento", "nro_dni")) || String(dniPedido);
  let paterno = txt(campo(d, "apellido_paterno", "apellidoPaterno", "ap_paterno", "paterno", "apPaterno", "last_name_father", "primer_apellido"));
  let materno = txt(campo(d, "apellido_materno", "apellidoMaterno", "ap_materno", "materno", "apMaterno", "last_name_mother", "segundo_apellido"));
  if (!paterno && !materno) { // apellidos juntos
    const ap = txt(campo(d, "apellidos", "last_name", "apellido"));
    if (ap) { const partes = ap.split(/\s+/); paterno = partes[0] || ""; materno = partes.slice(1).join(" "); }
  }
  const completo = !nombres && !paterno ? txt(campo(d, "nombre_completo", "nombreCompleto", "full_name", "fullName")) : "";
  let nom = nombres, pat = paterno, mat = materno;
  if (completo) { const t = completo.split(/\s+/); pat = t[0] || ""; mat = t[1] || ""; nom = t.slice(2).join(" "); }
  if (!nom && !pat) return null;
  const foto = fotoLimpia(campo(d, "foto", "foto_base64", "imagen", "photo", "image", "fotografia", "picture"));
  return { dni, nombres: nom, apellidoPaterno: pat, apellidoMaterno: mat,
    fechaNacimiento: fechaISO(txt(campo(d, "fecha_nacimiento", "fechaNacimiento", "nacimiento", "birth_date", "birthdate", "fec_nacimiento"))),
    genero: txt(campo(d, "genero", "sexo", "gender")), direccion: txt(campo(d, "direccion", "domicilio", "address")),
    ubigeo: txt(campo(d, "ubigeo", "ubigeo_reniec", "codigo_ubigeo")), distrito: txt(campo(d, "distrito", "district")),
    provincia: txt(campo(d, "provincia", "province")), departamento: txt(campo(d, "departamento", "department", "region")),
    estadoCivil: txt(campo(d, "estado_civil", "estadoCivil", "civil_status")), restriccion: txt(campo(d, "restriccion", "restricciones")),
    ...(foto ? { fotoBase64: foto } : {}), fuente: "apidni", consultadoAt: new Date().toISOString() };
}

export class Reniec {
  constructor(dir, { token = process.env.APIDNI_TOKEN || "", url = process.env.APIDNI_URL || "https://apidni.com/api/v2/dni", cacheDias = Number(process.env.RENIEC_CACHE_DIAS || 365) } = {}) {
    this.cacheDias = cacheDias;
    this.configRuta = path.join(dir, "configuracion.json");
    // Token y URL pueden venir del entorno (APIDNI_TOKEN, APIDNI_URL) o guardarse desde Administración.
    const c = this.#leerConfig();
    this.token = token || c.apidniToken || "";
    this.url = c.apidniUrl || url;
    this.modoAuth = c.apidniAuth || "bearer";
    // Fotos "genéricas" del proveedor (la misma imagen para personas distintas = "No hay foto disponible").
    this.fotosVistas = c.fotosVistas || {};      // hash → primer DNI con esa foto
    this.fotosGenericas = new Set(c.fotosGenericas || []);
    this.consumo = c.consumo || { total: 0, exitosas: 0, rechazadas: 0, porDia: {} }; // llamadas reales al proveedor
    this.ultimaCruda = null; // última respuesta del proveedor (para calibrar desde Administración)
    this.ruta = path.join(dir, "reniec-cache.json");
    try { this.cache = JSON.parse(fs.readFileSync(this.ruta, "utf8")); } catch { this.cache = {}; }
  }

  get real() { return Boolean(this.token); }

  #leerConfig() { try { return JSON.parse(fs.readFileSync(this.configRuta, "utf8")); } catch { return {}; } }

  /** Guarda el token (vacío = quitarlo). Aplica al instante. */
  establecerToken(token) { this.token = String(token || "").trim(); this.modoAuth = "bearer"; this.#guardarConfig({ apidniToken: this.token, apidniAuth: "bearer" }); }

  /** Guarda la URL del servicio (sin el /{dni} final). Vacía = la de apidni.com. */
  establecerUrl(url) {
    let u = String(url || "").trim().replace(/\/+$/, "").replace(/\/(?:[\[{(](?:num_doc|dni|numero|nro)[\]})]|num_doc)$/i, "").replace(/\/+$/, "");
    this.url = u || "https://apidni.com/api/v2/dni";
    this.#guardarConfig({ apidniUrl: u });
  }

  #urlCon(dni, modo) {
    const base = `${this.url}/${dni}`;
    if (!modo.startsWith("q:")) return base;
    return `${base}${base.includes("?") ? "&" : "?"}${modo.slice(2)}=${encodeURIComponent(this.token)}`;
  }
  #cabeceras(modo) {
    if (modo === "bearer") return { Authorization: `Bearer ${this.token}` };
    if (modo.startsWith("h:")) return { [modo.slice(2)]: this.token };
    return {};
  }

  /** Quita la foto si es la imagen genérica del proveedor (misma imagen en DNI distintos). */
  #filtrarFotoGenerica(p) {
    if (!p.fotoBase64) return p;
    const h = crypto.createHash("sha1").update(p.fotoBase64).digest("hex");
    if (this.fotosGenericas.has(h)) { const { fotoBase64, ...sin } = p; return { ...sin, fotoGenerica: true }; }
    const primero = this.fotosVistas[h];
    if (primero && primero !== p.dni) {
      this.fotosGenericas.add(h);
      this.#guardarConfig({ fotosGenericas: [...this.fotosGenericas] });
      const { fotoBase64, ...sin } = p; return { ...sin, fotoGenerica: true };
    }
    if (!primero) { this.fotosVistas[h] = p.dni; this.#guardarConfig({ fotosVistas: this.fotosVistas }); }
    return p;
  }

  #contar(exito) {
    const dia = new Date().toISOString().slice(0, 10);
    this.consumo.total++; this.consumo[exito ? "exitosas" : "rechazadas"]++;
    this.consumo.porDia[dia] = (this.consumo.porDia[dia] || 0) + 1;
    for (const k of Object.keys(this.consumo.porDia)) if (k < new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)) delete this.consumo.porDia[k];
    this.#guardarConfig({ consumo: this.consumo });
  }

  resumenConsumo() {
    const hoy = new Date().toISOString().slice(0, 10), mes = hoy.slice(0, 7);
    return { total: this.consumo.total, exitosas: this.consumo.exitosas, rechazadas: this.consumo.rechazadas, hoy: this.consumo.porDia[hoy] || 0,
      esteMes: Object.entries(this.consumo.porDia).filter(([d]) => d.startsWith(mes)).reduce((a, [, n]) => a + n, 0), enCache: Object.keys(this.cache).length };
  }

  #guardarConfig(cambios) {
    const c = { ...this.#leerConfig(), ...cambios };
    fs.writeFileSync(this.configRuta, JSON.stringify(c, null, 1), { mode: 0o600 });
  }

  #guardar() {
    try { fs.writeFileSync(this.ruta + ".tmp", JSON.stringify(this.cache)); fs.renameSync(this.ruta + ".tmp", this.ruta); } catch { /* sin disco */ }
  }

  simulado(dni) {
    const n = Number(dni);
    const nombres = ["MARIA ELENA", "JOSE LUIS", "ROSA", "CARLOS ALBERTO", "ANA", "JUAN"];
    const ap = ["QUISPE", "HUAMAN", "FLORES", "ROJAS", "MAMANI", "GARCIA", "TORRES", "RAMOS"];
    return { dni, nombres: nombres[n % 6], apellidoPaterno: ap[n % 8], apellidoMaterno: ap[(n >> 3) % 8],
      fechaNacimiento: `${1950 + (n % 50)}-${String(1 + (n % 12)).padStart(2, "0")}-${String(1 + (n % 28)).padStart(2, "0")}`,
      genero: n % 2 ? "F" : "M", direccion: "AV. SIMULADA 123", ubigeo: "150101", distrito: "LIMA", provincia: "LIMA", departamento: "LIMA",
      fuente: "simulado", consultadoAt: new Date().toISOString() };
  }

  async consultar(dni, { forzar = false } = {}) {
    if (!/^\d{8}$/.test(dni)) throw { status: 400, message: "El DNI debe tener 8 dígitos." };
    if (!this.real) return this.simulado(dni);
    const g = this.cache[dni];
    if (!forzar && g && Date.now() - Date.parse(g.consultadoAt) < this.cacheDias * 86_400_000) return this.#filtrarFotoGenerica({ ...g, fuente: "cache" });

    // Formas de enviar el token según el proveedor: cabecera Bearer (apidni.com), parámetro en la URL
    // (token_api / token / api_token) o cabecera simple. Se prueba la recordada primero y se guarda la que funcione.
    const MODOS = ["bearer", "q:token_api", "q:token", "q:api_token", "h:token", "h:x-api-key", "h:api-key"];
    const orden = [this.modoAuth, ...MODOS.filter((m) => m !== this.modoAuth)].filter(Boolean);
    let res, texto, j, ultimoError = null;
    for (const modo of orden) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12_000);
      try {
        res = await fetch(this.#urlCon(dni, modo), { headers: { Accept: "application/json", ...this.#cabeceras(modo) }, signal: ctrl.signal });
      } catch (e) {
        throw { status: 502, message: e?.name === "AbortError" ? "RENIEC no respondió a tiempo. Intenta de nuevo." : "No se pudo conectar con el servicio de DNI." };
      } finally { clearTimeout(t); }
      texto = await res.text();
      try { j = JSON.parse(texto); } catch { j = { _texto: texto.slice(0, 500) }; }
      this.ultimaCruda = { status: res.status, modo, cuerpo: texto.slice(0, 1500) };
      const motivo = txt(j?.respuesta ?? j?.message ?? j?.mensaje ?? j?.error ?? j?.msg);
      // Límite del plan o token expirado: el token SÍ fue reconocido; no tiene sentido probar otras formas de enviarlo.
      const esLimiteOExpirado = /super[oó]|l[ií]mite|consultas del plan|expirad/i.test(motivo);
      const tokenRechazado = !esLimiteOExpirado && (res.status === 401 || res.status === 403 || /token.*(no es v[aá]lido|inv[aá]lid)|invalid token|unauthori|no autorizado|api ?key|credencial/i.test(motivo));
      if (!tokenRechazado) { if (this.modoAuth !== modo) { this.modoAuth = modo; this.#guardarConfig({ apidniAuth: modo }); } break; }
      ultimoError = motivo || `HTTP ${res.status}`;
      res = null;
    }
    if (!res) { this.#contar(false); throw { status: 401, message: `El servicio de DNI rechazó el token (${ultimoError}). Revisa el token en Administración.` }; }
    if (res.status === 404) throw { status: 404, message: "El DNI no figura en RENIEC. Verifica el número." };
    if (!res.ok) throw { status: 502, message: `El servicio de DNI respondió ${res.status}.` };
    const p = normalizar(j, dni);
    this.#contar(Boolean(p));
    if (!p) {
      const motivo = txt(j.respuesta ?? j.message ?? j.mensaje ?? j.error ?? j.msg) || "Error en la consulta";
      const status = clasificar(motivo);
      throw { status, message: status === 404 ? "El DNI no figura en RENIEC. Verifica el número." : motivo };
    }
    this.cache[dni] = p;
    this.#guardar();
    return this.#filtrarFotoGenerica(p);
  }
}
