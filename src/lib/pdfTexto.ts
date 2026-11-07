// Adaptador de unpdf. La versión 1.x (sin las vulnerabilidades de la 0.12) une
// las páginas con saltos de línea; los lectores de Radar (constancias, DJ,
// rentas, bancos…) se calibraron con el formato de la 0.12, que unía todo con
// espacios simples. Este adaptador conserva EXACTAMENTE ese formato.
export async function getDocumentProxy(data: Uint8Array): Promise<any> {
  const u: any = await import("unpdf");
  return u.getDocumentProxy(data);
}

export async function extractText(pdf: any, opts: { mergePages?: boolean } = {}): Promise<{ totalPages: number; text: any }> {
  const u: any = await import("unpdf");
  const r = await u.extractText(pdf, { mergePages: false });
  const paginas: string[] = Array.isArray(r.text) ? r.text : [String(r.text ?? "")];
  return {
    totalPages: r.totalPages ?? paginas.length,
    text: opts.mergePages ? paginas.join("\n").replace(/\s+/g, " ") : paginas,
  };
}

export async function extractImages(pdf: any, pagina: number): Promise<any> {
  const u: any = await import("unpdf");
  return u.extractImages(pdf, pagina);
}
