// Plano del C.C. (un solo piso) — PLANO DE EJEMPLO.
// Cuando tengan el plano real, solo se cambia este archivo: cada bloque dice
// dónde está una galería y cuántos stands tiene. Unidades libres (≈ 1 unidad = 10 cm).
//
// Tipos de bloque:
//   corredor → pasillo con stands a ambos lados (izquierda 01..n, derecha n+1..2n)
//   fila     → stands uno al lado del otro (de izquierda a derecha)
//   stands   → lista explícita [{ codigo, x, y, w, h }] para formas irregulares

export const PLANO = {
  ancho: 1200,
  alto: 616,
  muro: { x: 8, y: 8, w: 1184, h: 600 },
  // Cajas grandes y legibles (personas mayores): 60 × 54 por stand.
  corredor: { anchoStand: 60, altoStand: 54, pasillo: 26 },

  bloques: [
    { galeria: "A", tipo: "corredor", x: 92, y: 22, porLado: 4, abre: "abajo" },
    { galeria: "B", tipo: "corredor", x: 246, y: 22, porLado: 4, abre: "abajo" },
    { galeria: "C", tipo: "corredor", x: 400, y: 22, porLado: 4, abre: "abajo" },
    { galeria: "D", tipo: "corredor", x: 554, y: 22, porLado: 4, abre: "abajo" },
    { galeria: "E", tipo: "corredor", x: 92, y: 324, porLado: 4, abre: "arriba" },
    { galeria: "F", tipo: "corredor", x: 246, y: 324, porLado: 4, abre: "arriba" },
    { galeria: "G", tipo: "corredor", x: 400, y: 324, porLado: 4, abre: "arriba" },
    { galeria: "H", tipo: "corredor", x: 554, y: 324, porLado: 4, abre: "arriba" },
    { galeria: "P", tipo: "fila", x: 712, y: 22, n: 6, w: 79, h: 74, etiqueta: { x: 949, y: 118 } },
    { galeria: "S", tipo: "fila", x: 712, y: 346, n: 4, w: 118.5, h: 124, etiqueta: { x: 949, y: 338 } },
  ],

  // Ambientes que no son stands (solo referencia visual).
  zonas: [
    { tipo: "pasillo", texto: "Pasaje central", x: 10, y: 238, w: 1180, h: 86, tx: 640, ty: 286 },
    { tipo: "mesas", texto: "", x: 712, y: 128, w: 474, h: 104 },
    { tipo: "ambiente", texto: "Administración", x: 16, y: 22, w: 66, h: 216 },
    { tipo: "ambiente", texto: "Guardianía", x: 16, y: 324, w: 66, h: 216 },
    { tipo: "ambiente", texto: "Tópico", x: 16, y: 548, w: 66, h: 52 },
    { tipo: "ambiente", texto: "SS.HH. Varones", x: 92, y: 548, w: 146, h: 52 },
    { tipo: "ambiente", texto: "SS.HH. Damas", x: 246, y: 548, w: 146, h: 52 },
    { tipo: "ambiente", texto: "Depósito", x: 400, y: 548, w: 300, h: 52 },
    { tipo: "ambiente", texto: "Carga y descarga", x: 712, y: 480, w: 474, h: 120 },
  ],

  ingresos: [
    { texto: "Ingreso principal", lado: "izquierda", y: 246, h: 70 },
    { texto: "Ingreso posterior", lado: "derecha", y: 246, h: 70 },
  ],
};
