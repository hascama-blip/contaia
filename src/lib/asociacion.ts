// ============================================================
//  Sitio editable — Instituto Mutualista Sanitaria del Perú (/asociacionmutualista)
// ============================================================
// Página PÚBLICA con plantilla fija editable (paleta azul marino + dorado):
//   carrusel de flyers, cursos disponibles/próximos con VALORACIÓN por estrellas
//   (los alumnos recomiendan), calendario de cursos, sugerencias de próximos
//   cursos, estadísticas y testimonios.
// La EDICIÓN se protege con un usuario/clave aparte:
//   env  ASOCIACION_EDIT_PASSWORD  (clave; mínimo 4 caracteres para habilitar)
//   env  ASOCIACION_EDIT_USER      (usuario; opcional, default "instituto")
// Medios (imágenes/videos) → archivos en el volumen (DATA_DIR); contenido +
// valoraciones + sugerencias → store JSON.

import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
export const MEDIA_DIR = path.join(DATA_DIR, "asociacion-media");

export const ASOC_COOKIE = "asoc_edit";
const PASS = process.env.ASOCIACION_EDIT_PASSWORD || "";
export const ASOC_USER = process.env.ASOCIACION_EDIT_USER || "instituto";

export function edicionHabilitada(): boolean { return PASS.length >= 4; }
export function tokenEsperado(): string {
  return crypto.createHmac("sha256", PASS || "disabled").update("asoc-edit-v1").digest("hex");
}
const igual = (a: string, b: string) => {
  const A = Buffer.from(a || ""), B = Buffer.from(b || "");
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
export function credencialesOk(user: string, pw: string): boolean {
  return edicionHabilitada() && igual(String(user || "").trim(), ASOC_USER) && igual(pw, PASS);
}
export function cookieValida(valor: string | undefined | null): boolean {
  return edicionHabilitada() && !!valor && igual(valor, tokenEsperado());
}

// ---- Medios ----------------------------------------------------------------
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/gif": "gif", "image/avif": "avif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};
export const MEDIA_MAX = 60 * 1024 * 1024;
export async function guardarMedia(buf: Buffer, mime: string): Promise<string> {
  const ext = MIME_EXT[String(mime).toLowerCase()];
  if (!ext) throw new Error("Tipo de archivo no permitido (usa imagen o video).");
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const id = crypto.randomBytes(10).toString("hex") + "." + ext;
  await fs.writeFile(path.join(MEDIA_DIR, id), buf);
  return `/api/asociacion/media/${id}`;
}
export function contentTypeDe(id: string): string {
  const ext = (id.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  };
  return map[ext] || "application/octet-stream";
}
export function idMediaValido(id: string): boolean {
  return /^[a-f0-9]{10,}\.[a-z0-9]{2,5}$/i.test(id);
}

// ---- Contenido -------------------------------------------------------------
export interface Flyer { imagen: string; titulo: string; link: string }
export interface Curso {
  id: string; imagen: string; titulo: string; descripcion: string;
  fecha: string; modalidad: string; precio: string; link: string; destacado?: boolean;
}
export interface EventoCal { fecha: string; curso: string; modalidad: string }
export interface Stat { icono: string; valor: string; label: string }
export interface Testimonio { nombre: string; rol: string; texto: string }
export interface Aliado { logo: string; nombre: string; link: string }

export interface AsociacionContenido {
  marca: string; logo: string; lema: string;
  flyers: Flyer[];
  disponiblesTitulo: string; cursosDisponibles: Curso[];
  proximosTitulo: string; cursosProximos: Curso[];
  calendarioTitulo: string; calendario: EventoCal[];
  stats: Stat[];
  testimoniosTitulo: string; testimonios: Testimonio[];
  aliadosTitulo: string; aliados: Aliado[];
  contactoTitulo: string; contactoTexto: string;
  telefono: string; email: string; direccion: string; facebook: string;
  actualizado?: string;
}

const nid = () => crypto.randomBytes(8).toString("hex");

export const CONTENIDO_DEFAULT: AsociacionContenido = {
  marca: "Instituto Mutualista Sanitaria del Perú",
  logo: "",
  lema: "Formación de excelencia para el personal de salud del Perú.",
  flyers: [],
  disponiblesTitulo: "Cursos disponibles",
  cursosDisponibles: [
    { id: nid(), imagen: "", titulo: "Soporte Vital Básico (BLS)", descripcion: "Certificación en reanimación cardiopulmonar y primeros auxilios.", fecha: "Inscripciones abiertas", modalidad: "Presencial", precio: "S/ 250", link: "", destacado: true },
    { id: nid(), imagen: "", titulo: "Bioseguridad Hospitalaria", descripcion: "Normas y protocolos de bioseguridad en establecimientos de salud.", fecha: "Inscripciones abiertas", modalidad: "Virtual", precio: "S/ 180", link: "" },
    { id: nid(), imagen: "", titulo: "Gestión de la Calidad en Salud", descripcion: "Herramientas para la mejora continua en servicios de salud.", fecha: "Inscripciones abiertas", modalidad: "Virtual", precio: "S/ 220", link: "" },
  ],
  proximosTitulo: "Próximos cursos",
  cursosProximos: [
    { id: nid(), imagen: "", titulo: "Auditoría Médica", descripcion: "Fundamentos de la auditoría en salud.", fecha: "Marzo 2026", modalidad: "Virtual", precio: "S/ 300", link: "" },
    { id: nid(), imagen: "", titulo: "Farmacología Clínica", descripcion: "Actualización en farmacología aplicada.", fecha: "Abril 2026", modalidad: "Presencial", precio: "S/ 280", link: "" },
  ],
  calendarioTitulo: "Calendario de cursos",
  calendario: [
    { fecha: "15/02/2026", curso: "Soporte Vital Básico (BLS)", modalidad: "Presencial" },
    { fecha: "01/03/2026", curso: "Bioseguridad Hospitalaria", modalidad: "Virtual" },
    { fecha: "20/03/2026", curso: "Auditoría Médica", modalidad: "Virtual" },
  ],
  stats: [
    { icono: "", valor: "+5,000", label: "Egresados capacitados" },
    { icono: "", valor: "+120", label: "Cursos dictados" },
    { icono: "", valor: "+40", label: "Docentes especialistas" },
    { icono: "", valor: "4.8/5", label: "Satisfacción de alumnos" },
  ],
  testimoniosTitulo: "Lo que dicen nuestros alumnos",
  testimonios: [
    { nombre: "María Q.", rol: "Enfermera", texto: "Excelente organización y docentes de primer nivel. Muy recomendado." },
    { nombre: "Luis R.", rol: "Técnico en enfermería", texto: "Los cursos me ayudaron a mejorar en mi trabajo. Volveré a inscribirme." },
  ],
  aliadosTitulo: "Nuestros aliados",
  aliados: [],
  contactoTitulo: "Contáctanos",
  contactoTexto: "Escríbenos para más información sobre inscripciones y convenios.",
  telefono: "", email: "", direccion: "", facebook: "",
};

const s = (v: any, def = "") => (typeof v === "string" ? v : def);
const arr = <T,>(v: any, map: (x: any) => T, max = 60): T[] => (Array.isArray(v) ? v.slice(0, max).map(map) : []);
const curso = (x: any): Curso => ({
  id: s(x?.id) || nid(), imagen: s(x?.imagen), titulo: s(x?.titulo), descripcion: s(x?.descripcion),
  fecha: s(x?.fecha), modalidad: s(x?.modalidad), precio: s(x?.precio), link: s(x?.link), destacado: !!x?.destacado,
});

export function normalizarContenido(c: any): AsociacionContenido {
  const d = CONTENIDO_DEFAULT;
  return {
    marca: s(c?.marca, d.marca), logo: s(c?.logo), lema: s(c?.lema, d.lema),
    flyers: arr(c?.flyers, (x) => ({ imagen: s(x?.imagen), titulo: s(x?.titulo), link: s(x?.link) }), 15),
    disponiblesTitulo: s(c?.disponiblesTitulo, d.disponiblesTitulo),
    cursosDisponibles: Array.isArray(c?.cursosDisponibles) ? c.cursosDisponibles.slice(0, 40).map(curso) : d.cursosDisponibles,
    proximosTitulo: s(c?.proximosTitulo, d.proximosTitulo),
    cursosProximos: Array.isArray(c?.cursosProximos) ? c.cursosProximos.slice(0, 40).map(curso) : d.cursosProximos,
    calendarioTitulo: s(c?.calendarioTitulo, d.calendarioTitulo),
    calendario: arr(c?.calendario, (x) => ({ fecha: s(x?.fecha), curso: s(x?.curso), modalidad: s(x?.modalidad) }), 60),
    stats: arr(c?.stats, (x) => ({ icono: s(x?.icono, ""), valor: s(x?.valor), label: s(x?.label) }), 8),
    testimoniosTitulo: s(c?.testimoniosTitulo, d.testimoniosTitulo),
    testimonios: arr(c?.testimonios, (x) => ({ nombre: s(x?.nombre), rol: s(x?.rol), texto: s(x?.texto) }), 20),
    aliadosTitulo: s(c?.aliadosTitulo, d.aliadosTitulo),
    aliados: arr(c?.aliados, (x) => ({ logo: s(x?.logo), nombre: s(x?.nombre), link: s(x?.link) }), 40),
    contactoTitulo: s(c?.contactoTitulo, d.contactoTitulo), contactoTexto: s(c?.contactoTexto, d.contactoTexto),
    telefono: s(c?.telefono), email: s(c?.email), direccion: s(c?.direccion), facebook: s(c?.facebook),
    actualizado: new Date().toISOString(),
  };
}

// ---- Valoraciones (rating por curso) y sugerencias -------------------------
export interface RatingAgg { sum: number; count: number }
export interface Sugerencia { nombre: string; tema: string; email: string; at: string }
