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
  alto: 560,
  muro: { x: 10, y: 10, w: 1180, h: 540 },
  corredor: { anchoStand: 46, altoStand: 44, pasillo: 34 },

  bloques: [
    { galeria: "A", tipo: "corredor", x: 140, y: 24, porLado: 4, abre: "abajo" },
    { galeria: "B", tipo: "corredor", x: 276, y: 24, porLado: 4, abre: "abajo" },
    { galeria: "C", tipo: "corredor", x: 412, y: 24, porLado: 4, abre: "abajo" },
    { galeria: "D", tipo: "corredor", x: 548, y: 24, porLado: 4, abre: "abajo" },
    { galeria: "E", tipo: "corredor", x: 140, y: 300, porLado: 4, abre: "arriba" },
    { galeria: "F", tipo: "corredor", x: 276, y: 300, porLado: 4, abre: "arriba" },
    { galeria: "G", tipo: "corredor", x: 412, y: 300, porLado: 4, abre: "arriba" },
    { galeria: "H", tipo: "corredor", x: 548, y: 300, porLado: 4, abre: "arriba" },
    { galeria: "P", tipo: "fila", x: 700, y: 24, n: 6, w: 80, h: 56, etiqueta: { x: 940, y: 104 } },
    { galeria: "S", tipo: "fila", x: 700, y: 330, n: 4, w: 120, h: 100, etiqueta: { x: 940, y: 318 } },
  ],

  // Ambientes que no son stands (solo referencia visual).
  zonas: [
    { tipo: "pasillo", texto: "Pasaje central", x: 12, y: 200, w: 1176, h: 100, tx: 620, ty: 254 },
    { tipo: "mesas", texto: "", x: 700, y: 112, w: 480, h: 76 },
    { tipo: "ambiente", texto: "Administración", x: 20, y: 24, w: 105, h: 176 },
    { tipo: "ambiente", texto: "Guardianía", x: 20, y: 300, w: 105, h: 176 },
    { tipo: "ambiente", texto: "Tópico", x: 20, y: 486, w: 105, h: 54 },
    { tipo: "ambiente", texto: "SS.HH. Varones", x: 140, y: 486, w: 126, h: 54 },
    { tipo: "ambiente", texto: "SS.HH. Damas", x: 276, y: 486, w: 126, h: 54 },
    { tipo: "ambiente", texto: "Depósito", x: 412, y: 486, w: 262, h: 54 },
    { tipo: "ambiente", texto: "Carga y descarga", x: 700, y: 446, w: 480, h: 94 },
  ],

  ingresos: [
    { texto: "Ingreso principal", lado: "izquierda", y: 215, h: 70 },
    { texto: "Ingreso posterior", lado: "derecha", y: 215, h: 70 },
  ],
};
