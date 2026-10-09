// Adaptador para el servidor propio: da a la web el mismo window.claude que
// tiene en claude.ai (db, assets, user, downloads), pero contra /api/*.
// Avisos en vivo por SSE (/api/eventos): cuando otra persona cambia algo,
// la colección se vuelve a leer.
(function () {
  const pedir = async (metodo, ruta, cuerpo, cabeceras = {}) => {
    const r = await fetch(ruta, { method: metodo, headers: { ...(cuerpo !== undefined && !(cuerpo instanceof Blob) ? { "Content-Type": "application/json" } : {}), ...cabeceras },
      body: cuerpo instanceof Blob ? cuerpo : cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
    if (r.status === 401) { location.href = "/login?vencida=1"; throw { code: "revoked", message: "La sesión venció." }; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw { code: j.code || `http_${r.status}`, message: j.error || "Error del servidor." };
    return j;
  };

  // ---- db ----
  const oyentes = new Map(); // col → Set(fn)
  const cache = new Map();   // col → Map(id → data)  (copia local; el servidor avisa cada cambio)
  let fuente = null, reconectando = false;
  function conectarEventos() {
    if (fuente) return;
    fuente = new EventSource("/api/eventos");
    fuente.onopen = () => { if (reconectando) { reconectando = false; for (const col of oyentes.keys()) refrescar(col); } }; // tras una caída, releer por si se perdió algo
    fuente.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      const c = cache.get(m.col);
      if (m.id && c) { if (m.data) c.set(m.id, m.data); else c.delete(m.id); avisarCol(m.col); guardarCopia(m.col); } // parche local: sin volver a bajar todo
      else refrescar(m.col);
    };
    fuente.onerror = () => { fuente.close(); fuente = null; reconectando = true; setTimeout(conectarEventos, 3000); };
  }
  const foto = (c) => ({ docs: [...c].map(([id, data]) => ({ id, exists: true, data: () => data, metadata: {} })) });
  // Copia en el navegador: la pantalla aparece al instante con lo último visto y luego se sincroniza.
  const LS = "censo_copia_";
  const guardarCopia = (col) => { try { localStorage.setItem(LS + col, JSON.stringify([...cache.get(col)])); } catch { /* sin espacio o bloqueado */ } };
  const leerCopia = (col) => { try { const v = localStorage.getItem(LS + col); return v ? new Map(JSON.parse(v)) : null; } catch { return null; } };
  function avisarCol(col) { const fns = oyentes.get(col), c = cache.get(col); if (fns && c) for (const fn of fns) fn(foto(c)); }
  async function refrescar(col) {
    if (!oyentes.get(col)?.size) return;
    try { const { docs } = await pedir("GET", `/api/db/${col}`); cache.set(col, new Map(docs.map((d) => [d.id, d.data]))); avisarCol(col); guardarCopia(col); }
    catch (e) { for (const fn of oyentes.get(col) || []) fn.error?.(e); }
  }
  const doc = (path) => ({
    id: path.split("/")[1], path,
    get: async () => { const r = await fetch(`/api/db/${path}`); if (r.status === 404) return { id: path.split("/")[1], exists: false, data: () => undefined }; const d = await r.json(); return { id: d.id, exists: true, data: () => d.data }; },
    set: (d) => pedir("PUT", `/api/db/${path}`, d),
    update: (d) => pedir("PATCH", `/api/db/${path}`, d),
    delete: () => pedir("DELETE", `/api/db/${path}`),
  });
  const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const db = {
    doc,
    collection: (col) => ({
      doc: (id) => doc(`${col}/${id || nuevoId()}`),
      onSnapshot: (next, error) => {
        if (!oyentes.has(col)) oyentes.set(col, new Set());
        next.error = error; oyentes.get(col).add(next);
        conectarEventos();
        if (cache.has(col)) next(foto(cache.get(col)));
        else { const copia = leerCopia(col); if (copia) next(foto(copia)); refrescar(col); }
        return () => oyentes.get(col).delete(next);
      },
    }),
  };

  // ---- user ----
  let sesion = null;
  const miSesion = async () => (sesion ||= pedir("GET", "/api/sesion"));
  const user = {
    me: async () => { const s = await miSesion(); return { id: s.usuario.id, name: s.usuario.nombre, rol: s.usuario.rol }; },
    id: async () => (await miSesion()).usuario.id,
    can: async (q) => { const s = await miSesion(); return q === "data.write" ? s.puedeEscribir : q === "incidencias.write" ? Boolean(s.puedeIncidencias) : s.esAdmin; },
    canEdit: async () => (await miSesion()).esAdmin,
    isOwner: async () => (await miSesion()).esAdmin,
    profiles: async (ids) => { const lista = [].concat(ids).filter(Boolean); return lista.length ? pedir("GET", `/api/usuarios/perfiles?ids=${lista.map(encodeURIComponent).join(",")}`) : {}; },
  };

  // ---- assets ----
  const assets = {
    upload: (blob, op) => pedir("POST", "/api/archivos", blob, { "Content-Type": (op && op.type) || blob.type || "application/octet-stream", "X-Nombre": encodeURIComponent(blob.name || "") }),
    delete: (id) => pedir("DELETE", `/api/archivos/${id}`),
    list: async () => ({ assets: [], usage: {} }),
  };

  // ---- downloads ----
  const downloads = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      return { status: "saved" };
    },
  };

  window.claude = { use: (nombre) => Promise.resolve({ db, user, assets, downloads }[nombre] || null) };
  const borrarCopias = () => { try { Object.keys(localStorage).filter((k) => k.startsWith(LS)).forEach((k) => localStorage.removeItem(k)); } catch { /* nada */ } };
  window.cerrarSesion = () => pedir("DELETE", "/api/sesion").then(() => { borrarCopias(); location.href = "/login"; });
})();
