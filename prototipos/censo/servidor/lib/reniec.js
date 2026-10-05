// Consulta de DNI vía apidni.com (misma lógica que src/lib/reniec.ts de Radar),
// con caché en disco para no gastar dos veces la misma consulta.
import fs from "node:fs";
import path from "node:path";

const txt = (v) => String(v ?? "").trim();
const fechaISO = (v) => {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(txt(v));
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
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

export class Reniec {
  constructor(dir, { token = process.env.APIDNI_TOKEN || "", url = process.env.APIDNI_URL || "https://apidni.com/api/v2/dni", cacheDias = Number(process.env.RENIEC_CACHE_DIAS || 365) } = {}) {
    this.token = token; this.url = url; this.cacheDias = cacheDias;
    this.ruta = path.join(dir, "reniec-cache.json");
    try { this.cache = JSON.parse(fs.readFileSync(this.ruta, "utf8")); } catch { this.cache = {}; }
  }

  get real() { return Boolean(this.token); }

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
    if (!forzar && g && Date.now() - Date.parse(g.consultadoAt) < this.cacheDias * 86_400_000) return { ...g, fuente: "cache" };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    let res;
    try {
      res = await fetch(`${this.url}/${dni}`, { headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" }, signal: ctrl.signal });
    } catch (e) {
      throw { status: 502, message: e?.name === "AbortError" ? "RENIEC no respondió a tiempo. Intenta de nuevo." : "No se pudo conectar con el servicio de DNI." };
    } finally { clearTimeout(t); }
    if (res.status === 401 || res.status === 403) throw { status: 401, message: "El token de apidni no es válido o venció." };
    if (!res.ok) throw { status: 502, message: `El servicio de DNI respondió ${res.status}.` };
    const j = await res.json().catch(() => ({}));
    const d = j.data || {};
    if (!(Number(j.codigo) > 0) || !txt(d.dni)) {
      const motivo = txt(j.respuesta) || "Error en la consulta";
      const status = clasificar(motivo);
      throw { status, message: status === 404 ? "El DNI no figura en RENIEC. Verifica el número." : motivo };
    }
    const foto = fotoLimpia(d.foto ?? d.foto_base64 ?? d.imagen ?? d.photo);
    const p = { dni: txt(d.dni), nombres: txt(d.nombres), apellidoPaterno: txt(d.apellido_paterno), apellidoMaterno: txt(d.apellido_materno),
      fechaNacimiento: fechaISO(d.fecha_nacimiento), genero: txt(d.genero), direccion: txt(d.direccion), ubigeo: txt(d.ubigeo),
      distrito: txt(d.distrito), provincia: txt(d.provincia), departamento: txt(d.departamento), ...(foto ? { fotoBase64: foto } : {}),
      fuente: "apidni", consultadoAt: new Date().toISOString() };
    this.cache[dni] = p;
    this.#guardar();
    return p;
  }
}
