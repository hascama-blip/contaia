// Ficha del Libro de Padrón como imagen SVG (misma disposición que el PDF de src/lib/exportar.js),
// para la consulta pública por DNI: cabecera, identificación y datos personales con foto. No incluye
// hijos, otros familiares ni observaciones. Los datos confidenciales (DNI, dirección, correo, celular
// y fijo, cónyuge, cuenta bancaria) se reemplazan por "CONFIDENCIAL".
// Se sirve como <img>: no se puede seleccionar ni editar en la página. Sin scripts, todo escapado.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fecha = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
export const CONFIDENCIAL = "CONFIDENCIAL";

// Medidas en mm (viewBox A4 = 210 × 297), iguales a las del PDF.
const M = 12, ANCHO = 186, F = 6.5;
const NEGRO = "#141414", GRIS = "#5a5a5a", BORDE = "#3c3c3c", CELESTE = "#deeaf6", VERDE = "#d9ead3", AMARILLO = "#ffe34d";
const FUENTE = "Helvetica, Arial, sans-serif";
const pt = (n) => n * 0.3528; // puntos → mm
/** Recorta el texto a lo que cabe en el ancho (aprox. 0,5 × tamaño por carácter). */
const recortar = (texto, w, sizePt) => { const s = String(texto ?? "").replace(/\s+/g, " ").trim(); const max = Math.max(1, Math.floor((w - 2.4) / (pt(sizePt) * 0.52))); return s.length > max ? s.slice(0, max - 1) + "…" : s; };

/**
 * @param {object} a            ficha del asociado
 * @param {object} op           { stands: [{codigo, cuenta}], logo: dataURL|null, foto: dataURL|null, fechaConsulta: "DD/MM/AAAA", institucion: { ruc } }
 */
export function fichaSVG(a, { stands = [], logo = null, foto = null, fechaConsulta = "", institucion = { ruc: "20386547565" } } = {}) {
  const partes = [];
  const rect = (x, y, w, h, fill = "none") => partes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${BORDE}" stroke-width="0.25"/>`);
  const texto = (x, y, t, { size = 8, bold = false, align = "start", color = NEGRO, italic = false } = {}) => { if (t === "" || t === null || t === undefined) return; partes.push(`<text x="${x}" y="${y}" font-family="${FUENTE}" font-size="${pt(size).toFixed(2)}" font-weight="${bold ? "700" : "400"}"${italic ? ' font-style="italic"' : ""} fill="${color}" text-anchor="${align === "center" ? "middle" : align === "right" ? "end" : "start"}">${esc(t)}</text>`); };
  /** Celda con borde, relleno opcional y texto centrado verticalmente (como `celda` del PDF). */
  const celda = (x, y, w, h, t, { fill = null, bold = false, size = 8, align = "left", color = NEGRO, italic = false } = {}) => {
    rect(x, y, w, h, fill || "none");
    const s = String(t ?? "").trim(); if (!s) return;
    const tx = align === "center" ? x + w / 2 : align === "right" ? x + w - 1.2 : x + 1.2;
    texto(tx, y + h / 2 + pt(size) * 0.35, recortar(s, w, size), { size, bold, align, color, italic });
  };
  const confidencial = (x, y, w, h) => celda(x, y, w, h, CONFIDENCIAL, { size: 7, color: GRIS, italic: true, align: "center" });
  const etiqueta = (x, y, w, h, t) => celda(x, y, w, h, t, { fill: CELESTE, bold: true, size: 7 });
  let y = 7;
  const titulo = (t) => { texto(105, y + 3.6, t, { size: 9, bold: true, align: "center" }); y += 5.5; };

  // ---- Cabecera ----
  const HC = 20.3; rect(M, y, ANCHO, HC);
  if (logo) partes.push(`<image x="${M + 1.5}" y="${y + 1.3}" width="17.5" height="17.5" preserveAspectRatio="xMidYMid meet" href="${logo}"/>`);
  const cx = M + 33.5 + (ANCHO - 33.5) / 2;
  texto(cx, y + 5.6, "Asociación de Propietarios Centro Comercial", { size: 12, bold: true, align: "center" });
  texto(cx, y + 10.6, "“INMACULADA CONCEPCIÓN”", { size: 13, bold: true, align: "center" });
  texto(cx, y + 14.2, "Fundada el 23 de noviembre de 1997", { size: 7.5, align: "center", color: GRIS });
  texto(cx, y + 16.9, `RUC: ${institucion.ruc}`, { size: 7.5, align: "center", color: GRIS });
  texto(cx, y + 19.3, "Reconocimiento de Personería Jurídica 15 diciembre 1997 Título N° 11009298", { size: 7.5, align: "center", color: GRIS });
  y += HC + 2;
  texto(105, y + 4.2, "LIBRO DE PADRÓN DE ASOCIADOS", { size: 13, bold: true, align: "center" });
  y += 7.5;

  // ---- Identificación: N° asociado · stands · cuentas (cuenta = confidencial) ----
  const cods = stands.map((s) => s.codigo);
  const H1 = 5.6, wEt = 30, wNum = 33.5, wSep = 4.6, wEt2 = 25, wStand = (ANCHO - wEt - wNum - wSep - wEt2) / 5;
  etiqueta(M, y, wEt, H1, "N° DE ASOCIADO");
  celda(M + wEt, y, wNum, H1 * 2, a.numero || "", { bold: true, size: 11, align: "center" });
  etiqueta(M + wEt + wNum + wSep, y, wEt2, H1, "N° DE STAND");
  etiqueta(M + wEt + wNum + wSep, y + H1, wEt2, H1, "N° CUENTA BCO.");
  rect(M, y + H1, wEt, H1);
  for (let i = 0; i < 5; i++) {
    const x = M + wEt + wNum + wSep + wEt2 + i * wStand;
    celda(x, y, wStand, H1, cods[i] || "", { fill: cods[i] ? AMARILLO : null, bold: true, size: 8, align: "center" });
    if (i === 0 && (stands.some((s) => s.cuenta) || a.cuentaBancaria)) confidencial(x, y + H1, wStand, H1); else celda(x, y + H1, wStand, H1, "", { size: 6.5 });
  }
  if (cods.length > 5) texto(M + ANCHO, y + H1 * 2 + 2.6, `y ${cods.length - 5} más: ${cods.slice(5).join(", ")}`, { size: 6, color: GRIS, align: "right" });
  y += H1 * 2 + 3;

  // ---- Datos personales con foto ----
  const n = a.nacimiento || {};
  const c1 = 35.3, c2 = 35.3, c3 = 30, c4 = 26.5, c5 = 21.2, c6 = ANCHO - (c1 + c2 + c3 + c4 + c5);
  const xf = M + c1 + c2 + c3 + c4 + c5, anchoSinFoto = c1 + c2 + c3 + c4 + c5;
  const ET = { fill: CELESTE, bold: true, size: 7 }, VAL = { size: 8.5 }, VALB = { size: 9.5, bold: true };
  const fila = (yy, cols) => { let x = M; for (const [w, t, op] of cols) { if (t === CONFIDENCIAL) confidencial(x, yy, w, F); else celda(x, yy, w, F, t, op); x += w; } };
  fila(y, [[c1, "NOMBRES", ET], [anchoSinFoto - c1, a.nombres, VALB]]);
  fila(y + F, [[c1, "APELLIDO PATERNO", ET], [anchoSinFoto - c1, a.apellidoPaterno, VALB]]);
  fila(y + F * 2, [[c1, "APELLIDO MATERNO", ET], [anchoSinFoto - c1, a.apellidoMaterno, VALB]]);
  fila(y + F * 3, [[c1, "FECHA DE NAC.", ET], [c2, fecha(a.fechaNacimiento), VAL], [c3, "DNI", ET], [c4 + c5, CONFIDENCIAL]]);
  fila(y + F * 4, [[c1, "DISTRITO", ET], [c2, n.distrito, VAL], [c3, "PROVINCIA", ET], [c4 + c5, n.provincia, VAL]]);
  fila(y + F * 5, [[c1, "DEPARTAMENTO", ET], [anchoSinFoto - c1, n.departamento, VAL]]);
  fila(y + F * 6, [[c1, "OCUPACIÓN", ET], [c2, a.ocupacion, VAL], [c3, "GRADO INSTRUCC.", ET], [c4 + c5, a.instruccion, VAL]]);
  rect(xf, y, c6, F * 7);
  if (foto) partes.push(`<image x="${xf + 0.6}" y="${y + 0.6}" width="${c6 - 1.2}" height="${F * 7 - 1.2}" preserveAspectRatio="xMidYMid slice" href="${foto}"/>`);
  else texto(xf + c6 / 2, y + F * 3.5, "FOTO", { size: 7, color: GRIS, align: "center" });
  fila(y + F * 7, [[c1, "DIRECCIÓN", ET], [c2 + c3 + c4 - 26.5, CONFIDENCIAL], [26.5, "DISTRITO", ET], [c5 + c6, a.distritoResidencia, VAL]]);
  fila(y + F * 8, [[c1, "FECHA DE INGRESO", ET], [c2, fecha(a.fechaIngreso), VAL], [c3, "EMAIL", ET], [c4 + c5 + c6, CONFIDENCIAL]]);
  fila(y + F * 9, [[c1, "CELULAR Y FIJO", ET], [c2, CONFIDENCIAL], [c3, "ESTADO CIVIL", ET], [c4 + c5 + c6, a.estadoCivil, VAL]]);
  fila(y + F * 10, [[c1, "CÓNYUGE / CONVIV.", ET], [c2, CONFIDENCIAL], [c3, "NOMBRE", ET], [c4 + c5 + c6, CONFIDENCIAL]]);
  y += F * 11 + 3;

  // (La consulta pública termina aquí: no se muestran hijos, otros familiares ni observaciones.)

  // ---- Pie: consulta pública ----
  texto(105, y + 3, `Vista previa de la ficha del Libro de Padrón${fechaConsulta ? ` · ${fechaConsulta}` : ""} · los datos confidenciales se muestran ocultos · ccinmaculadaconcepcion.com`, { size: 6.5, color: GRIS, align: "center" });
  const ALTO = Math.min(297, Math.ceil(y + 8));

  // Marca de agua diagonal (no estorba la lectura, deja claro que es una consulta y no el documento oficial).
  const marca = `<text x="105" y="${ALTO / 2}" font-family="${FUENTE}" font-size="22" font-weight="700" fill="${GRIS}" fill-opacity="0.08" text-anchor="middle" transform="rotate(-30 105 ${ALTO / 2})">VISTA PREVIA</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 ${ALTO}" width="840" height="${ALTO * 4}" role="img" aria-label="Ficha del Libro de Padrón de Asociados">
<rect width="210" height="${ALTO}" fill="#fff"/>
${marca}
${partes.join("\n")}
</svg>`;
}
