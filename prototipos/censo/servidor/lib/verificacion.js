// Verificación automática de DNI: cada madrugada recorre las fichas sin verificar, consulta
// RENIEC (vía el proveedor configurado) y guarda datos y foto. Se detiene sola cuando el
// proveedor avisa el límite de consultas y retoma al día siguiente con los que falten.
import fs from "node:fs";
import path from "node:path";

const ZONA = "America/Lima";
const ESTADO_CIVIL = { SOLTERO: "Soltero(a)", SOLTERA: "Soltero(a)", CASADO: "Casado(a)", CASADA: "Casado(a)", CONVIVIENTE: "Conviviente", DIVORCIADO: "Divorciado(a)", DIVORCIADA: "Divorciado(a)", VIUDO: "Viudo(a)", VIUDA: "Viudo(a)" };
const MAX_INTENTOS = 3;         // tras 3 errores propios del DNI (p. ej. no figura) se deja de intentar
const PAUSA_MS = 400;           // entre consultas, para no saturar al proveedor

export const capitalizar = (s) => String(s || "").toLowerCase().replace(/(^|[\s\-])(\p{L})/gu, (m, sep, l) => sep + l.toUpperCase());
export const dniValido = (dni) => /^\d{8}$/.test(String(dni || "").replace(/\D/g, ""));

/** Campos de la ficha a partir de la persona de RENIEC (mismo criterio que la pantalla). */
export function camposDesdePersona(p) {
  const civil = ESTADO_CIVIL[String(p.estadoCivil || "").trim().toUpperCase()];
  return {
    nombres: capitalizar(p.nombres), apellidoPaterno: capitalizar(p.apellidoPaterno), apellidoMaterno: capitalizar(p.apellidoMaterno),
    ...(p.fechaNacimiento ? { fechaNacimiento: p.fechaNacimiento } : {}),
    ...(p.direccion ? { direccion: p.direccion } : {}),
    ...(p.distrito ? { distritoResidencia: capitalizar(p.distrito) } : {}),
    ...(civil ? { estadoCivil: civil } : {}),
  };
}

/** Hora local de Lima "HH:MM" → próximo instante (ms) en que ocurre, a partir de `desde`. */
export function proximaEjecucion(hora, desde = Date.now()) {
  const [hh, mm] = String(hora || "00:30").split(":").map((n) => Number(n) || 0);
  const partes = (ms) => { const f = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)); const g = Object.fromEntries(f.map((x) => [x.type, x.value])); return { ...g, hour: g.hour === "24" ? "00" : g.hour }; };
  const d = partes(desde);
  // Lima es UTC-5 todo el año (sin horario de verano): se arma la fecha en UTC y se suman 5 h.
  const enUTC = (y, mo, da, h, mi) => Date.UTC(y, mo - 1, da, h + 5, mi, 0, 0);
  let t = enUTC(+d.year, +d.month, +d.day, hh, mm);
  if (t <= desde) t = enUTC(+d.year, +d.month, +d.day + 1, hh, mm);
  return t;
}

export class Verificacion {
  /**
   * @param {object} dep  { almacen, reniec, guardarArchivo(buffer, tipo, nombre) → id, dir }
   */
  constructor({ almacen, reniec, guardarArchivo, dir, hora = process.env.CENSO_VERIFICACION_HORA || "00:30" }) {
    this.almacen = almacen; this.reniec = reniec; this.guardarArchivo = guardarArchivo;
    this.ruta = path.join(dir, "verificacion.json");
    let g = {}; try { g = JSON.parse(fs.readFileSync(this.ruta, "utf8")); } catch { /* primera vez */ }
    this.activa = g.activa ?? true;
    this.hora = g.hora || hora;
    this.ultima = g.ultima || null;      // resumen de la última corrida
    this.historial = g.historial || [];  // últimas 30 corridas
    this.corriendo = false;
    this.detener = false;
    this.temporizador = null;
  }

  #guardar() {
    const tmp = this.ruta + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ activa: this.activa, hora: this.hora, ultima: this.ultima, historial: this.historial.slice(-30) }, null, 1));
    fs.renameSync(tmp, this.ruta);
  }

  /** Fichas con DNI válido que aún no se verificaron (y no agotaron sus intentos). */
  pendientes() {
    return this.almacen.listar("asociados")
      .map(({ id, data }) => ({ id, ...data }))
      .filter((a) => dniValido(a.dni) && !a.reniec?.verificadoAt && (a.reniec?.intentos || 0) < MAX_INTENTOS)
      .sort((a, b) => String(a.numero).localeCompare(String(b.numero), "es", { numeric: true }));
  }

  estado() {
    const todos = this.almacen.listar("asociados").map(({ data }) => data);
    return {
      activa: this.activa, hora: this.hora, zona: ZONA, corriendo: this.corriendo,
      proxima: this.activa ? new Date(proximaEjecucion(this.hora)).toISOString() : null,
      pendientes: this.pendientes().length,
      verificados: todos.filter((a) => a.reniec?.verificadoAt).length,
      sinDni: todos.filter((a) => !dniValido(a.dni)).length,
      agotados: todos.filter((a) => !a.reniec?.verificadoAt && (a.reniec?.intentos || 0) >= MAX_INTENTOS).length,
      ultima: this.ultima, historial: this.historial.slice(-10).reverse(),
    };
  }

  configurar({ activa, hora }) {
    if (activa !== undefined) this.activa = Boolean(activa);
    if (hora !== undefined) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hora))) throw { status: 400, message: "La hora debe tener formato HH:MM (24 h), por ejemplo 00:30." }; this.hora = hora; }
    this.#guardar();
    this.programar();
  }

  /** Deja el reloj armado para la próxima madrugada (reprograma si cambia la hora). */
  programar() {
    clearTimeout(this.temporizador);
    if (!this.activa) return;
    const espera = Math.max(1000, proximaEjecucion(this.hora) - Date.now());
    this.temporizador = setTimeout(() => { this.ejecutar({ origen: "programada" }).catch(() => {}).finally(() => this.programar()); }, Math.min(espera, 2 ** 31 - 1));
    this.temporizador.unref();
  }

  /**
   * Recorre los pendientes en orden hasta terminar o hasta que el proveedor frene (límite, token).
   * @returns {Promise<object>} resumen
   */
  async ejecutar({ origen = "manual", maximo = Infinity } = {}) {
    if (this.corriendo) throw { status: 409, message: "Ya hay una verificación en curso." };
    this.corriendo = true; this.detener = false;
    const r = { inicio: new Date().toISOString(), fin: null, origen, procesados: 0, verificados: 0, conFoto: 0, noFiguran: 0, errores: 0, pendientesAlInicio: 0, pendientesAlFinal: 0, motivoParada: "", detalle: [] };
    try {
      if (!this.reniec.real) { r.motivoParada = "sin_token"; return r; }
      const lista = this.pendientes();
      r.pendientesAlInicio = lista.length;
      let fallosRed = 0;
      for (const a of lista) {
        if (this.detener) { r.motivoParada = "detenida"; break; }
        if (r.procesados >= maximo) { r.motivoParada = "maximo"; break; }
        let persona;
        try {
          persona = await this.reniec.consultar(a.dni);
        } catch (e) {
          const st = e?.status || 502;
          if (st === 429) { r.motivoParada = "limite_proveedor"; r.mensajeProveedor = e.message; break; }
          if (st === 401) { r.motivoParada = "token_rechazado"; r.mensajeProveedor = e.message; break; }
          if (st === 502) { fallosRed++; r.errores++; r.detalle.push({ id: a.id, numero: a.numero, dni: a.dni, error: e.message }); if (fallosRed >= 3) { r.motivoParada = "sin_conexion"; break; } continue; }
          // 400/404: problema del DNI en sí → se anota y se cuenta el intento
          r.procesados++; r.noFiguran++;
          r.detalle.push({ id: a.id, numero: a.numero, dni: a.dni, error: e.message });
          this.almacen.actualizar("asociados", a.id, { reniec: { ...(a.reniec || {}), intentos: (a.reniec?.intentos || 0) + 1, ultimoError: e.message, intentadoAt: new Date().toISOString() } });
          await pausa(PAUSA_MS);
          continue;
        }
        fallosRed = 0;
        if (!persona || persona.fuente === "simulado") { r.motivoParada = "sin_token"; break; }
        r.procesados++;
        const cambios = { ...camposDesdePersona(persona), reniec: { verificadoAt: new Date().toISOString(), fuente: persona.fuente || "apidni", por: "automatico" }, actualizadoAt: new Date().toISOString(), actualizadoPor: null };
        // Foto del DNI: solo si la ficha aún no tiene foto (no se pisa una foto tomada por la directiva).
        if (persona.fotoBase64 && !a.archivos?.foto) {
          try {
            const buf = Buffer.from(persona.fotoBase64, "base64");
            const tipo = buf[0] === 0x89 && buf[1] === 0x50 ? "image/png" : "image/jpeg";
            const id = this.guardarArchivo(buf, tipo, `dni-${a.dni}.${tipo === "image/png" ? "png" : "jpg"}`);
            cambios.archivos = { foto: id };
            r.conFoto++;
          } catch (e) { r.detalle.push({ id: a.id, numero: a.numero, dni: a.dni, error: `foto: ${e.message}` }); }
        }
        this.almacen.actualizar("asociados", a.id, cambios);
        r.verificados++;
        await pausa(PAUSA_MS);
      }
      if (!r.motivoParada) r.motivoParada = "completa";
      return r;
    } finally {
      r.fin = new Date().toISOString();
      r.pendientesAlFinal = this.pendientes().length;
      r.detalle = r.detalle.slice(0, 50);
      this.ultima = r; this.historial.push({ inicio: r.inicio, fin: r.fin, origen, procesados: r.procesados, verificados: r.verificados, conFoto: r.conFoto, noFiguran: r.noFiguran, errores: r.errores, motivoParada: r.motivoParada, pendientesAlFinal: r.pendientesAlFinal });
      this.historial = this.historial.slice(-30);
      this.corriendo = false;
      try { this.#guardar(); } catch { /* sin disco */ }
    }
  }

  pedirDetener() { this.detener = true; }
}

const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
