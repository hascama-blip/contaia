// Exportaciones: CSV (se abre en Excel) y ficha del asociado en PDF.
// El archivo se entrega con la capacidad "downloads" (el usuario confirma la descarga).
import { INSTITUCION } from "../config.js";
import { ESTADOS_ASOCIADO, ESTADOS_CENSO, ESTADOS_STAND } from "./types.js";
import { fecha, hoy } from "./formato.js";
import { nombreCompleto, nombreGaleria } from "./padron.js";
import { archivoComoDataURL } from "./archivos.js";

let conexion = null;

export function conectarDescargas() {
  if (!conexion) {
    conexion = window.claude?.use ? window.claude.use("downloads") : Promise.resolve(null);
  }
  return conexion;
}

export async function descargar(nombre, datos) {
  const d = await conectarDescargas();
  if (!d) throw { code: "unavailable", message: "Las descargas no están disponibles en esta vista." };
  return d.save({ filename: nombre, data: datos });
}

/** columnas: [{ titulo, valor: (fila) => texto }] */
export function aCSV(columnas, filas) {
  const celda = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [columnas.map((c) => celda(c.titulo)).join(",")];
  for (const f of filas) lineas.push(columnas.map((c) => celda(c.valor(f))).join(","));
  return "﻿" + lineas.join("\r\n"); // BOM: Excel respeta tildes y ñ
}

// ---------- PDF de la ficha ----------
const JSPDF_URL = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";

function cargarJsPDF() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = JSPDF_URL;
    s.onload = () => (window.jspdf?.jsPDF ? ok(window.jspdf.jsPDF) : mal(new Error("jsPDF no cargó")));
    s.onerror = () => mal(new Error("No se pudo cargar el generador de PDF."));
    document.head.appendChild(s);
  });
}

async function imagen(id) {
  if (!id) return null;
  try {
    return await archivoComoDataURL(id);
  } catch {
    return null;
  }
}

async function logoDataURL() {
  try {
    const r = await fetch(INSTITUCION.logo);
    const b = await r.blob();
    return await new Promise((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result);
      fr.readAsDataURL(b);
    });
  } catch {
    return null;
  }
}

const formatoImg = (dataUrl) => (/^data:image\/png/.test(dataUrl) ? "PNG" : "JPEG");

/** Genera el PDF de la ficha y devuelve un Blob. */
export async function pdfFicha(a, { stands = [] } = {}) {
  const JsPDF = await cargarJsPDF();
  const [foto, firma, huella, logo] = await Promise.all([imagen(a.archivos?.foto), imagen(a.archivos?.firma), imagen(a.archivos?.huella), logoDataURL()]);
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const M = 16;
  const ANCHO = 210 - M * 2;
  let y = M;

  const azul = [16, 43, 77];
  const gris = [100, 116, 139];
  const linea = [226, 232, 240];

  const saltoSiHaceFalta = (alto) => {
    if (y + alto > 297 - M) {
      doc.addPage();
      y = M;
    }
  };

  // Cabecera
  if (logo) doc.addImage(logo, "JPEG", M, y, 16, 16);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...azul);
  doc.text(INSTITUCION.nombrePlano, M + 20, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...gris);
  doc.text(`LIBRO DE PADRÓN DE ASOCIADOS · RUC ${INSTITUCION.ruc}`, M + 20, y + 11);
  doc.text(`Ficha N° ${a.numero || "—"} · emitida el ${fecha(hoy().iso)}`, M + 20, y + 15.5);

  // Foto carné
  const fx = M + ANCHO - 30;
  doc.setDrawColor(...linea);
  doc.rect(fx, y, 30, 38);
  if (foto) {
    try { doc.addImage(foto, formatoImg(foto), fx + 0.5, y + 0.5, 29, 37); } catch { /* imagen no legible */ }
  } else {
    doc.setFontSize(7);
    doc.text("FOTO", fx + 15, y + 20, { align: "center" });
  }
  y += 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(30, 41, 59);
  doc.text(doc.splitTextToSize(nombreCompleto(a), ANCHO - 36), M, y);
  y += 18;

  const seccion = (titulo) => {
    saltoSiHaceFalta(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...azul);
    doc.text(titulo.toUpperCase(), M, y);
    doc.setDrawColor(...linea);
    doc.line(M, y + 1.8, M + ANCHO, y + 1.8);
    y += 7;
  };
  // Pares etiqueta/valor en 3 columnas
  const pares = (lista) => {
    const col = ANCHO / 3;
    for (let i = 0; i < lista.length; i += 3) {
      const fila = lista.slice(i, i + 3);
      const altos = fila.map(([, v]) => doc.splitTextToSize(String(v || "—"), col - 4).length);
      const alto = 4 + Math.max(...altos) * 4.2;
      saltoSiHaceFalta(alto + 2);
      fila.forEach(([et, v], j) => {
        const x = M + j * col;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...gris);
        doc.text(et.toUpperCase(), x, y);
        doc.setFontSize(9.5);
        doc.setTextColor(30, 41, 59);
        doc.text(doc.splitTextToSize(String(v || "—"), col - 4), x, y + 4.2);
      });
      y += alto + 2;
    }
  };
  const tabla = (cabeceras, filas, anchos) => {
    saltoSiHaceFalta(10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...gris);
    let x = M;
    cabeceras.forEach((c, i) => { doc.text(c.toUpperCase(), x, y); x += anchos[i]; });
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    if (!filas.length) {
      doc.text("—", M, y);
      y += 6;
      return;
    }
    for (const f of filas) {
      saltoSiHaceFalta(6);
      x = M;
      f.forEach((v, i) => { doc.text(String(v || "—"), x, y); x += anchos[i]; });
      y += 5.2;
    }
    y += 2;
  };

  const n = a.nacimiento || {};
  seccion("1 · Identificación");
  pares([
    ["N° de asociado", a.numero],
    ["Stands", stands.map((s) => s.codigo).join(", ")],
    ["Cuenta bancaria", a.cuentaBancaria],
  ]);
  seccion("2 · Datos personales");
  pares([
    ["DNI", a.dni],
    ["Fecha de nacimiento", fecha(a.fechaNacimiento)],
    ["Lugar de nacimiento", [n.distrito, n.provincia, n.departamento].filter(Boolean).join(", ")],
    ["Ocupación", a.ocupacion],
    ["Grado de instrucción", a.instruccion],
    ["Estado civil", a.estadoCivil],
  ]);
  seccion("3 · Contacto y domicilio");
  pares([
    ["Dirección", a.direccion],
    ["Distrito de residencia", a.distritoResidencia],
    ["Celular", a.celular],
    ["Teléfono fijo", a.telefono],
    ["Correo electrónico", a.correo],
  ]);
  seccion("4 · Vínculo con la asociación");
  pares([
    ["Fecha de ingreso", fecha(a.fechaIngreso)],
    ["Estado del asociado", ESTADOS_ASOCIADO[a.estado]?.label],
    ["Estado del censo", ESTADOS_CENSO[a.censo?.estado || "pendiente"]?.label],
  ]);
  seccion("5 · Cónyuge o conviviente");
  pares([
    ["Nombre completo", a.conyuge?.nombre],
    ["DNI", a.conyuge?.dni],
    ["Celular", a.conyuge?.celular],
  ]);
  seccion("6 · Hijos");
  tabla(["Nombre", "Edad", "Estudios"], (a.hijos || []).map((h) => [h.nombre, h.edad, h.estudios]), [100, 25, 53]);
  seccion("7 · Otros familiares o dependientes");
  tabla(["Nombre", "Parentesco", "Estudios"], (a.familiares || []).map((f) => [f.nombre, f.parentesco, f.estudios]), [100, 35, 43]);
  seccion("8 · Stand e inquilino");
  tabla(
    ["Stand", "Galería", "Giro", "Estado", "Inquilino"],
    stands.map((s) => [s.codigo, nombreGaleria(s.galeria), s.giro, ESTADOS_STAND[s.estado]?.corto, s.inquilino?.nombre]),
    [18, 40, 36, 30, 54],
  );
  seccion("9 · Observaciones de la Junta Directiva");
  doc.setFontSize(9.5);
  const obs = doc.splitTextToSize(a.observaciones || "—", ANCHO);
  saltoSiHaceFalta(obs.length * 4.5 + 4);
  doc.text(obs, M, y);
  y += obs.length * 4.5 + 4;

  seccion("10 · Compromiso");
  doc.setFontSize(8.5);
  const casilla = (ok, texto) => {
    const lineas = doc.splitTextToSize(texto, ANCHO - 8);
    saltoSiHaceFalta(lineas.length * 4 + 3);
    doc.rect(M, y - 3, 3.5, 3.5);
    if (ok) doc.text("X", M + 0.8, y - 0.2);
    doc.text(lineas, M + 6, y);
    y += lineas.length * 4 + 2.5;
  };
  casilla(a.compromiso?.estatutos, "Me comprometo a cumplir con la asociación y sus estatutos.");
  casilla(a.compromiso?.datos, "Autorizo a la Asociación el tratamiento de mis datos personales y los de mi familia con fines de administración del padrón, conforme a la Ley N° 29733.");

  // Firmas
  saltoSiHaceFalta(62);
  y += 6;
  const anchoFirma = (ANCHO - 30) / 2;
  if (firma) {
    try { doc.addImage(firma, formatoImg(firma), M, y, anchoFirma, 18); } catch { /* */ }
  }
  doc.setDrawColor(...linea);
  doc.rect(M + ANCHO - 26, y - 4, 26, 30);
  if (huella) {
    try { doc.addImage(huella, formatoImg(huella), M + ANCHO - 25.5, y - 3.5, 25, 29); } catch { /* */ }
  }
  doc.setFontSize(7);
  doc.setTextColor(...gris);
  doc.text("HUELLA", M + ANCHO - 13, y + 29.5, { align: "center" });
  y += 20;
  doc.setDrawColor(30, 41, 59);
  doc.line(M, y, M + anchoFirma, y);
  doc.setFontSize(8);
  doc.text("Firma del asociado", M, y + 4);
  y += 20;
  const cargos = ["Presidente", "Secretario(a)", "Secretario de Organización"];
  const anchoCargo = (ANCHO - 16) / 3;
  cargos.forEach((c, i) => {
    const x = M + i * (anchoCargo + 8);
    doc.line(x, y, x + anchoCargo, y);
    doc.text(c, x, y + 4);
  });

  return doc.output("blob");
}

export const COLUMNAS_PADRON = (mapaStands, atraso) => [
  { titulo: "N°", valor: (a) => a.numero },
  { titulo: "Apellidos y nombres", valor: (a) => nombreCompleto(a) },
  { titulo: "DNI", valor: (a) => a.dni },
  { titulo: "Stands", valor: (a) => (mapaStands.get(a.id) || []).map((s) => s.codigo).join(" ") },
  { titulo: "Galería", valor: (a) => [...new Set((mapaStands.get(a.id) || []).map((s) => nombreGaleria(s.galeria)))].join(" / ") },
  { titulo: "Celular", valor: (a) => a.celular },
  { titulo: "Estado del censo", valor: (a) => ESTADOS_CENSO[a.censo?.estado || "pendiente"]?.label },
  { titulo: "Meses de atraso", valor: (a) => atraso(a).meses },
  { titulo: "Deuda (S/)", valor: (a) => atraso(a).monto },
  { titulo: "Fecha de ingreso", valor: (a) => a.fechaIngreso },
  { titulo: "Estado", valor: (a) => ESTADOS_ASOCIADO[a.estado]?.label },
];
