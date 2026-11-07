// Fecha de HOY en Perú (America/Lima), "YYYY-MM-DD". Los vencimientos de plan
// se comparan con esta fecha (antes con la de UTC, que en Lima cambia a las 19:00).
export function hoyLima(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
