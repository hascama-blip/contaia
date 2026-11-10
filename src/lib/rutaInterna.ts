// Destino tras iniciar sesión / aceptar políticas: SOLO rutas internas ("/algo").
// Se rechazan "//otro-sitio", "/\otro-sitio" y cualquier carácter de control o
// espacio: el navegador quita tabuladores y saltos de línea de las URL, así que
// "/<TAB>/otro-sitio" terminaría siendo "//otro-sitio" (redirección abierta).
export function rutaInterna(next: string | null | undefined, porDefecto = "/"): string {
  const n = String(next ?? "");
  // eslint-disable-next-line no-control-regex
  if (!n || n.length > 500 || /[\u0000- \u007f\\]/.test(n)) return porDefecto;
  return /^\/(?!\/)/.test(n) ? n : porDefecto;
}
