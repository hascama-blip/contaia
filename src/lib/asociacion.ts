// ============================================================
//  Sitio editable de la Asociación Mutualista (/asociacionmutualista)
// ============================================================
// Página PÚBLICA con plantilla fija editable (textos, imágenes, video, galería).
// La EDICIÓN se protege con un usuario/clave aparte (no los usuarios de Radar):
//   env  ASOCIACION_EDIT_PASSWORD  (clave; mínimo 4 caracteres para habilitar)
//   env  ASOCIACION_EDIT_USER      (usuario; opcional, default "asociacion")
// Los medios (imágenes/videos) se guardan como ARCHIVOS en el volumen (DATA_DIR)
// y se sirven por /api/asociacion/media/<id>. El contenido (textos + URLs) vive
// en el store JSON.

import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
export const MEDIA_DIR = path.join(DATA_DIR, "asociacion-media");

export const ASOC_COOKIE = "asoc_edit";
const PASS = process.env.ASOCIACION_EDIT_PASSWORD || "";
export const ASOC_USER = process.env.ASOCIACION_EDIT_USER || "asociacion";

/** La edición está habilitada solo si hay una clave configurada. */
export function edicionHabilitada(): boolean { return PASS.length >= 4; }

/** Token determinístico derivado de la clave (lo que guarda la cookie de edición). */
export function tokenEsperado(): string {
  return crypto.createHmac("sha256", PASS || "disabled").update("asoc-edit-v1").digest("hex");
}
const igual = (a: string, b: string) => {
  const A = Buffer.from(a || ""), B = Buffer.from(b || "");
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
/** ¿Usuario+clave correctos? */
export function credencialesOk(user: string, pw: string): boolean {
  return edicionHabilitada() && igual(String(user || "").trim(), ASOC_USER) && igual(pw, PASS);
}
/** ¿La cookie de edición es válida? */
export function cookieValida(valor: string | undefined | null): boolean {
  return edicionHabilitada() && !!valor && igual(valor, tokenEsperado());
}

// ---- Medios ----------------------------------------------------------------
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/gif": "gif", "image/avif": "avif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};
export const MEDIA_MAX = 60 * 1024 * 1024; // 60 MB (videos)

/** Guarda un archivo de medios y devuelve su URL pública. */
export async function guardarMedia(buf: Buffer, mime: string): Promise<string> {
  const ext = MIME_EXT[String(mime).toLowerCase()];
  if (!ext) throw new Error("Tipo de archivo no permitido (usa imagen o video).");
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const id = crypto.randomBytes(10).toString("hex") + "." + ext;
  await fs.writeFile(path.join(MEDIA_DIR, id), buf);
  return `/api/asociacion/media/${id}`;
}
/** Content-Type a partir de la extensión del id de medios. */
export function contentTypeDe(id: string): string {
  const ext = (id.split(".").pop() || "").toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  };
  return map[ext] || "application/octet-stream";
}
/** id de medios seguro (solo hex + extensión). */
export function idMediaValido(id: string): boolean {
  return /^[a-f0-9]{10,}\.[a-z0-9]{2,5}$/i.test(id);
}

// ---- Contenido (plantilla fija editable) -----------------------------------
export interface Servicio { titulo: string; texto: string; icono: string }
export interface AsociacionContenido {
  marca: string;
  logo: string;
  // Portada (hero)
  heroTitulo: string;
  heroSubtitulo: string;
  heroBoton: string;
  heroImagen: string;
  // Quiénes somos
  nosotrosTitulo: string;
  nosotrosTexto: string;
  nosotrosImagen: string;
  // Servicios / Beneficios
  serviciosTitulo: string;
  servicios: Servicio[];
  // Galería
  galeriaTitulo: string;
  galeria: string[];
  // Video
  videoTitulo: string;
  video: string;
  // Contacto
  contactoTitulo: string;
  contactoTexto: string;
  telefono: string;
  email: string;
  direccion: string;
  facebook: string;
  actualizado?: string;
}

export const CONTENIDO_DEFAULT: AsociacionContenido = {
  marca: "Asociación Mutualista",
  logo: "",
  heroTitulo: "Bienvenido a nuestra Asociación Mutualista",
  heroSubtitulo: "Unidos por el bienestar y la solidaridad de nuestros asociados.",
  heroBoton: "Conócenos",
  heroImagen: "",
  nosotrosTitulo: "Quiénes somos",
  nosotrosTexto: "Somos una asociación sin fines de lucro dedicada al apoyo mutuo de nuestros miembros. Edita este texto con tu historia, misión y visión.",
  nosotrosImagen: "",
  serviciosTitulo: "Nuestros beneficios",
  servicios: [
    { titulo: "Apoyo solidario", texto: "Fondo de ayuda para los asociados en momentos difíciles.", icono: "🤝" },
    { titulo: "Actividades", texto: "Eventos, capacitaciones y encuentros para la comunidad.", icono: "🎉" },
    { titulo: "Asesoría", texto: "Orientación y acompañamiento para nuestros miembros.", icono: "📋" },
  ],
  galeriaTitulo: "Galería",
  galeria: [],
  videoTitulo: "Video institucional",
  video: "",
  contactoTitulo: "Contáctanos",
  contactoTexto: "Escríbenos o visítanos. Estamos para servirte.",
  telefono: "",
  email: "",
  direccion: "",
  facebook: "",
};

/** Normaliza un contenido parcial (de la edición) contra el default. */
export function normalizarContenido(c: any): AsociacionContenido {
  const d = CONTENIDO_DEFAULT;
  const s = (v: any, def: string) => (typeof v === "string" ? v : def);
  return {
    marca: s(c?.marca, d.marca),
    logo: s(c?.logo, ""),
    heroTitulo: s(c?.heroTitulo, d.heroTitulo),
    heroSubtitulo: s(c?.heroSubtitulo, d.heroSubtitulo),
    heroBoton: s(c?.heroBoton, d.heroBoton),
    heroImagen: s(c?.heroImagen, ""),
    nosotrosTitulo: s(c?.nosotrosTitulo, d.nosotrosTitulo),
    nosotrosTexto: s(c?.nosotrosTexto, d.nosotrosTexto),
    nosotrosImagen: s(c?.nosotrosImagen, ""),
    serviciosTitulo: s(c?.serviciosTitulo, d.serviciosTitulo),
    servicios: Array.isArray(c?.servicios)
      ? c.servicios.slice(0, 12).map((x: any) => ({ titulo: s(x?.titulo, ""), texto: s(x?.texto, ""), icono: s(x?.icono, "•") }))
      : d.servicios,
    galeriaTitulo: s(c?.galeriaTitulo, d.galeriaTitulo),
    galeria: Array.isArray(c?.galeria) ? c.galeria.filter((x: any) => typeof x === "string").slice(0, 60) : [],
    videoTitulo: s(c?.videoTitulo, d.videoTitulo),
    video: s(c?.video, ""),
    contactoTitulo: s(c?.contactoTitulo, d.contactoTitulo),
    contactoTexto: s(c?.contactoTexto, d.contactoTexto),
    telefono: s(c?.telefono, ""),
    email: s(c?.email, ""),
    direccion: s(c?.direccion, ""),
    facebook: s(c?.facebook, ""),
    actualizado: new Date().toISOString(),
  };
}
