// Exportaciones: CSV (se abre en Excel) y ficha del asociado en PDF.
// El archivo se entrega con la capacidad "downloads" (el usuario confirma la descarga).
import { INSTITUCION } from "../config.js";
import { ESTADOS_ASOCIADO, ESTADOS_CENSO, ESTADOS_STAND } from "./types.js";
import { fecha, hoy } from "./formato.js";
import { nombreCompleto, nombreGaleria, faltantes } from "./padron.js";
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

/** Genera el PDF de la ficha con el formato oficial del Libro de Padrón (una hoja A4) y devuelve un Blob. */
export async function pdfFicha(a, { stands = [] } = {}) {
  const JsPDF = await cargarJsPDF();
  const [foto, firma, huella, logo] = await Promise.all([imagen(a.archivos?.foto), imagen(a.archivos?.firma), imagen(a.archivos?.huella), logoDataURL()]);
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const M = 12;                 // margen lateral (1,2 cm como la plantilla)
  const ANCHO = 210 - M * 2;    // 186 mm
  const F = 6.5;                // alto de fila de las tablas (0,65 cm)
  const NEGRO = [20, 20, 20], GRIS = [90, 90, 90], BORDE = [60, 60, 60];
  const CELESTE = [222, 234, 246], VERDE = [217, 234, 211], AMARILLO = [255, 227, 77];
  let y = 7;

  doc.setFont("helvetica", "normal");
  doc.setDrawColor(...BORDE);
  doc.setLineWidth(0.25);

  // Marca de agua: el escudo grande y centrado, detrás de todo el contenido, con opacidad del 35 %.
  // Se dibuja primero para que quede al fondo; las celdas sin relleno son transparentes y lo dejan ver.
  if (logo && doc.GState) {
    try {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.35 }));
      const LADO = 120;
      doc.addImage(logo, formatoImg(logo), (210 - LADO) / 2, (297 - LADO) / 2, LADO, LADO);
      doc.restoreGraphicsState();
    } catch { /* si el visor no soporta transparencia, la ficha sale sin marca de agua */ }
  }

  /** Celda con borde, relleno opcional y texto centrado verticalmente (recorta si no cabe). */
  const celda = (x, yy, w, h, texto, { fill = null, bold = false, size = 8, align = "left", color = NEGRO } = {}) => {
    if (fill) { doc.setFillColor(...fill); doc.rect(x, yy, w, h, "FD"); } else doc.rect(x, yy, w, h);
    const t = String(texto ?? "").trim();
    if (!t) return;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    let lineas = doc.splitTextToSize(t, w - 2.4);
    const maxLineas = Math.max(1, Math.floor((h - 1) / (size * 0.42)));
    if (lineas.length > maxLineas) { lineas = lineas.slice(0, maxLineas); lineas[maxLineas - 1] = lineas[maxLineas - 1].replace(/.{2}$/, "…"); }
    const altoTexto = lineas.length * size * 0.42;
    const y0 = yy + (h - altoTexto) / 2 + size * 0.33;
    const tx = align === "center" ? x + w / 2 : align === "right" ? x + w - 1.2 : x + 1.2;
    doc.text(lineas, tx, y0, { align, baseline: "alphabetic" });
  };
  const etiqueta = (x, yy, w, h, texto) => celda(x, yy, w, h, texto, { fill: CELESTE, bold: true, size: 7 });
  const titulo = (texto) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...NEGRO);
    doc.text(texto, 105, y + 3.6, { align: "center" });
    y += 5.5;
  };
  const img = (data, x, yy, w, h) => { if (!data) return; try { doc.addImage(data, formatoImg(data), x, yy, w, h); } catch { /* imagen no legible */ } };

  // ---- Cabecera: escudo + razón social ----
  const HC = 20.3;
  doc.rect(M, y, ANCHO, HC);
  img(logo, M + 1.5, y + 1.3, 17.5, 17.5);
  doc.setTextColor(...NEGRO);
  doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text("Asociación de Propietarios Centro Comercial", M + 33.5 + (ANCHO - 33.5) / 2, y + 5.6, { align: "center" });
  doc.setFontSize(13);
  doc.text("“INMACULADA CONCEPCIÓN”", M + 33.5 + (ANCHO - 33.5) / 2, y + 10.6, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRIS);
  doc.text("Fundada el 23 de noviembre de 1997", M + 33.5 + (ANCHO - 33.5) / 2, y + 14.2, { align: "center" });
  doc.text(`RUC: ${INSTITUCION.ruc}`, M + 33.5 + (ANCHO - 33.5) / 2, y + 16.9, { align: "center" });
  doc.text("Reconocimiento de Personería Jurídica 15 diciembre 1997 Título N° 11009298", M + 33.5 + (ANCHO - 33.5) / 2, y + 19.3, { align: "center" });
  y += HC + 2;
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...NEGRO);
  doc.text("LIBRO DE PADRÓN DE ASOCIADOS", 105, y + 4.2, { align: "center" });
  y += 7.5;

  // ---- Identificación: N° asociado · 5 stands · 5 cuentas ----
  const cods = stands.map((s) => s.codigo);
  const cuentas = stands.map((s) => s.cuenta || "");
  if (!cuentas.some(Boolean) && a.cuentaBancaria) cuentas[0] = a.cuentaBancaria;
  const H1 = 5.6, wEt = 30, wNum = 33.5, wSep = 4.6, wEt2 = 25, wStand = (ANCHO - wEt - wNum - wSep - wEt2) / 5;
  etiqueta(M, y, wEt, H1, "N° DE ASOCIADO");
  celda(M + wEt, y, wNum, H1 * 2, a.numero || "", { bold: true, size: 11, align: "center" });
  etiqueta(M + wEt + wNum + wSep, y, wEt2, H1, "N° DE STAND");
  etiqueta(M + wEt + wNum + wSep, y + H1, wEt2, H1, "N° CUENTA BCO.");
  doc.rect(M, y + H1, wEt, H1);
  for (let i = 0; i < 5; i++) {
    const x = M + wEt + wNum + wSep + wEt2 + i * wStand;
    celda(x, y, wStand, H1, cods[i] || "", { fill: cods[i] ? AMARILLO : null, bold: true, size: 8, align: "center" });
    celda(x, y + H1, wStand, H1, cuentas[i] || "", { size: 6.5, align: "center" });
  }
  if (cods.length > 5) { doc.setFontSize(6); doc.setTextColor(...GRIS); doc.text(`y ${cods.length - 5} más: ${cods.slice(5).join(", ")}`, M + ANCHO, y + H1 * 2 + 2.6, { align: "right" }); }
  y += H1 * 2 + 3;

  // ---- Datos personales con foto ----
  const n = a.nacimiento || {};
  const c1 = 35.3, c2 = 35.3, c3 = 30, c4 = 26.5, c5 = 21.2, c6 = ANCHO - (c1 + c2 + c3 + c4 + c5); // 37,7 mm para la foto
  const xf = M + c1 + c2 + c3 + c4 + c5;
  const fila = (yy, partes) => { let x = M; for (const [w, texto, op] of partes) { celda(x, yy, w, F, texto, op); x += w; } };
  const ET = { fill: CELESTE, bold: true, size: 7 };
  const VAL = { size: 8.5 };
  const VALB = { size: 9.5, bold: true };
  const anchoSinFoto = c1 + c2 + c3 + c4 + c5;
  fila(y, [[c1, "NOMBRES", ET], [anchoSinFoto - c1, a.nombres, VALB]]);
  fila(y + F, [[c1, "APELLIDO PATERNO", ET], [anchoSinFoto - c1, a.apellidoPaterno, VALB]]);
  fila(y + F * 2, [[c1, "APELLIDO MATERNO", ET], [anchoSinFoto - c1, a.apellidoMaterno, VALB]]);
  fila(y + F * 3, [[c1, "FECHA DE NAC.", ET], [c2, fecha(a.fechaNacimiento), VAL], [c3, "DNI", ET], [c4 + c5, a.dni, { ...VALB, align: "center" }]]);
  fila(y + F * 4, [[c1, "DISTRITO", ET], [c2, n.distrito, VAL], [c3, "PROVINCIA", ET], [c4 + c5, n.provincia, VAL]]);
  fila(y + F * 5, [[c1, "DEPARTAMENTO", ET], [anchoSinFoto - c1, n.departamento, VAL]]);
  fila(y + F * 6, [[c1, "OCUPACIÓN", ET], [c2, a.ocupacion, VAL], [c3, "GRADO INSTRUCC.", ET], [c4 + c5, a.instruccion, VAL]]);
  // foto: ocupa las 7 primeras filas
  doc.rect(xf, y, c6, F * 7);
  if (foto) img(foto, xf + 0.6, y + 0.6, c6 - 1.2, F * 7 - 1.2);
  else { doc.setFontSize(7); doc.setTextColor(...GRIS); doc.text("FOTO", xf + c6 / 2, y + F * 3.5, { align: "center" }); }
  fila(y + F * 7, [[c1, "DIRECCIÓN", ET], [c2 + c3 + c4 - 26.5, a.direccion, VAL], [26.5, "DISTRITO", ET], [c5 + c6, a.distritoResidencia, VAL]]);
  fila(y + F * 8, [[c1, "FECHA DE INGRESO", ET], [c2, fecha(a.fechaIngreso), VAL], [c3, "EMAIL", ET], [c4 + c5 + c6, a.correo, VAL]]);
  fila(y + F * 9, [[c1, "CELULAR Y FIJO", ET], [c2, [a.celular, a.telefono].filter(Boolean).join(" / "), VAL], [c3, "ESTADO CIVIL", ET], [c4 + c5 + c6, a.estadoCivil, VAL]]);
  fila(y + F * 10, [[c1, "CÓNYUGE / CONVIV.", ET], [c2, a.conyuge?.dni ? `DNI ${a.conyuge.dni}` : "", VAL], [c3, "NOMBRE", ET], [c4 + c5 + c6, a.conyuge?.nombre, VAL]]);
  y += F * 11 + 3;

  // ---- Hijos ----
  titulo("NOMBRES Y DATOS DE LOS HIJOS");
  const h1 = 70.6, h2 = 28.2, h3 = 45.9, h4 = ANCHO - h1 - h2 - h3;
  const CAB = { fill: VERDE, bold: true, size: 7, align: "center" };
  fila(y, [[h1, "NOMBRES Y APELLIDOS", CAB], [h2, "EDAD", CAB], [h3, "ESTUDIOS", CAB], [h4, "DNI", CAB]]);
  for (let i = 0; i < 5; i++) {
    const h = (a.hijos || [])[i] || {};
    fila(y + F * (i + 1), [[h1, h.nombre, VAL], [h2, h.edad, { ...VAL, align: "center" }], [h3, h.estudios, VAL], [h4, h.dni, { ...VAL, align: "center" }]]);
  }
  if ((a.hijos || []).length > 5) { doc.setFontSize(6); doc.setTextColor(...GRIS); doc.text(`y ${a.hijos.length - 5} más (ver ficha en el portal)`, M + ANCHO, y + F * 6 + 2.6, { align: "right" }); }
  y += F * 6 + 3;

  // ---- Otros familiares ----
  titulo("OTROS FAMILIARES");
  const f1 = 70.6, f2 = 45.9, f3 = 21.2, f4 = ANCHO - f1 - f2 - f3;
  fila(y, [[f1, "NOMBRES Y APELLIDOS", CAB], [f2, "PARENTESCO", CAB], [f3, "EDAD", CAB], [f4, "ESTUDIOS", CAB]]);
  for (let i = 0; i < 4; i++) {
    const x = (a.familiares || [])[i] || {};
    fila(y + F * (i + 1), [[f1, x.nombre, VAL], [f2, x.parentesco, VAL], [f3, x.edad, { ...VAL, align: "center" }], [f4, x.estudios, VAL]]);
  }
  y += F * 5 + 3;

  // ---- Observaciones ----
  const HO = 17.6;
  doc.rect(M, y, ANCHO, HO);
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...NEGRO);
  doc.text("OBSERVACIONES:", M + 1.5, y + 3.6);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  const obs = doc.splitTextToSize(a.observaciones || "", ANCHO - 3).slice(0, 4);
  doc.text(obs, M + 1.5, y + 7.4);
  y += HO + 3;

  // ---- Compromiso ----
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("ME COMPROMETO A CUMPLIR CON LA ASOCIACIÓN Y SUS ESTATUTOS", 105, y + 3.6, { align: "center" });
  y += 7;

  // ---- Firmas y huella ----
  const wH = 31.7, g = 4.6, wFirma = (ANCHO - wH - 5.3 - g * 2) / 3, xF0 = M + wH + 5.3;
  const HF = 19.4 + 5.3 + 8.8 + 5.3; // 38,8 mm
  doc.rect(M, y, wH, 19.4 + 5.3 + 8.8);                                   // huella
  if (huella) img(huella, M + 1, y + 1, wH - 2, 19.4 + 5.3 + 8.8 - 2);
  celda(M, y + 19.4 + 5.3 + 8.8, wH, 5.3, "HUELLA DIGITAL", { fill: CELESTE, bold: true, size: 7, align: "center" });
  const cargos = ["PRESIDENTE", "ASOCIADO", "SECRETARIO(A)"];
  cargos.forEach((cgo, i) => {
    const x = xF0 + i * (wFirma + g);
    if (i === 1 && firma) img(firma, x + 2, y + 1, wFirma - 4, 17);
    doc.line(x, y + 19.4, x + wFirma, y + 19.4);
    celda(x, y + 19.4, wFirma, 5.3, cgo, { bold: true, size: 7, align: "center" });
  });
  const xSO = xF0 + (wFirma + g);
  doc.line(xSO, y + 19.4 + 5.3 + 8.8, xSO + wFirma, y + 19.4 + 5.3 + 8.8);
  celda(xSO, y + 19.4 + 5.3 + 8.8, wFirma, 5.3, "SECRETARIO DE ORGANIZACIÓN", { bold: true, size: 6.5, align: "center" });
  y += HF;

  // Pie
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(...GRIS);
  doc.text(`Ficha N° ${a.numero || "—"} · ${nombreCompleto(a)} · emitida el ${fecha(hoy().iso)} · ccinmaculadaconcepcion.com`, 105, 293, { align: "center" });

  return doc.output("blob");
}

export const COLUMNAS_PADRON = (mapaStands, atraso) => [
  { titulo: "N°", valor: (a) => a.numero },
  { titulo: "Apellidos y nombres", valor: (a) => nombreCompleto(a) },
  { titulo: "DNI", valor: (a) => a.dni },
  { titulo: "Stands", valor: (a) => (mapaStands.get(a.id) || []).map((s) => s.codigo).join(" ") },
  { titulo: "Galería", valor: (a) => [...new Set((mapaStands.get(a.id) || []).map((s) => nombreGaleria(s.galeria)))].join(" / ") },
  { titulo: "Celular", valor: (a) => a.celular },
  { titulo: "Estado de la ficha", valor: (a) => ESTADOS_CENSO[a.censo?.estado || "pendiente"]?.label },
  { titulo: "Verificado en RENIEC", valor: (a) => (a.reniec?.verificadoAt ? String(a.reniec.verificadoAt).slice(0, 10) : "") },
  { titulo: "Observación (falta)", valor: (a) => faltantes(a).join(", ") },
  { titulo: "Meses de atraso", valor: (a) => atraso(a).meses },
  { titulo: "Deuda (S/)", valor: (a) => atraso(a).monto },
  { titulo: "Fecha de ingreso", valor: (a) => a.fechaIngreso },
  { titulo: "Estado", valor: (a) => ESTADOS_ASOCIADO[a.estado]?.label },
];
