// ============================================================
//  Clasificación automática de compras por rubro del proveedor
// ============================================================
// A partir de la actividad económica (rubro) del proveedor —que sacamos de
// decolecta— se sugiere la cuenta contable. La memoria RUC→cuenta (lo que el
// operario confirma) SIEMPRE manda sobre la sugerencia, y se aprende.
//
// ⚠️ AJUSTABLE: estas reglas son un punto de partida. Cámbialas a tu plan de
// cuentas real (el módulo igual aprende por proveedor con cada confirmación).

export interface ReglaCuenta {
  rx: RegExp;
  cuenta: string;
  nombre: string;
}

export const REGLAS_CUENTA: ReglaCuenta[] = [
  { rx: /combustible|grifo|estaci[oó]n de servicio|petr[oó]leo|gas\b/i, cuenta: "656", nombre: "Suministros — combustible" },
  { rx: /transporte|carga|log[ií]stica|courier|env[ií]o|flete/i, cuenta: "631", nombre: "Transporte, correos y flete" },
  { rx: /hotel|hospedaje|hostal|alojamiento/i, cuenta: "631", nombre: "Alojamiento / viáticos" },
  { rx: /restaurant|comida|cevicher|pollos|men[uú]|cafeter/i, cuenta: "637", nombre: "Atenciones / representación" },
  { rx: /ferreter|construcci[oó]n|materiales|agregados|aceros?/i, cuenta: "603", nombre: "Materiales y suministros" },
  { rx: /contab|auditor|asesor|legal|abogad|notar|jur[ií]dic/i, cuenta: "632", nombre: "Asesoría y honorarios" },
  { rx: /public|marketing|imprenta|publicidad|dise[ñn]o gr[aá]fico/i, cuenta: "637", nombre: "Publicidad" },
  { rx: /electric|energ[ií]a|agua|tele(com|fon)|internet|claro|movistar|entel|bitel/i, cuenta: "636", nombre: "Servicios básicos" },
  { rx: /limpieza|seguridad|vigilancia|mantenimiento|reparaci/i, cuenta: "634", nombre: "Mantenimiento y servicios" },
  { rx: /software|sistemas|inform[aá]tica|tecnolog|programaci/i, cuenta: "639", nombre: "Servicios — software / TI" },
  { rx: /farmac|botica|salud|cl[ií]nica|m[eé]dic/i, cuenta: "659", nombre: "Otros gastos — salud" },
  { rx: /venta al por (menor|mayor)|comercio|bodega|market|supermercado|distribu/i, cuenta: "601", nombre: "Mercaderías / compras" },
  { rx: /alquiler|arrendamiento|inmobiliar/i, cuenta: "635", nombre: "Alquileres" },
  { rx: /seguro|p[oó]liza/i, cuenta: "651", nombre: "Seguros" },
];

export const CUENTA_DEFECTO = { cuenta: "609", nombre: "Compras / gastos por clasificar" };

/** Sugiere una cuenta según la actividad económica y la razón social. */
export function clasificar(
  actividad: string,
  razonSocial: string
): { cuenta: string; nombre: string } {
  const texto = `${actividad ?? ""} ${razonSocial ?? ""}`;
  for (const r of REGLAS_CUENTA) {
    if (r.rx.test(texto)) return { cuenta: r.cuenta, nombre: r.nombre };
  }
  return { ...CUENTA_DEFECTO };
}
