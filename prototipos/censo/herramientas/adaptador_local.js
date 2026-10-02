// Adaptador para la versión de UN SOLO ARCHIVO HTML (sin claude.ai):
// imita window.claude con lo que tiene el navegador.
//   db        → localStorage (todo el padrón), sembrado con los datos iniciales
//   assets    → IndexedDB (fotos, firmas, documentos)
//   downloads → descarga normal del navegador
// Los cambios quedan SOLO en este navegador y en esta computadora.
(function () {
  const CLAVE = "censo.base.v1";
  const SEMILLA = window.__SEMILLA__ || [];
  let store;
  try { store = JSON.parse(localStorage.getItem(CLAVE) || "null"); } catch { store = null; }
  if (!store) store = Object.fromEntries(SEMILLA.map((d) => [d.path, d.data]));
  const guardarTodo = () => { try { localStorage.setItem(CLAVE, JSON.stringify(store)); } catch (e) { alert("No se pudo guardar en este navegador: " + e.message); } };
  guardarTodo();

  const subs = new Map();
  const esObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const fusion = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = esObj(v) && esObj(a[k]) ? fusion(a[k], v) : v; return o; };
  const foto = (col) => ({ docs: Object.keys(store).filter((p) => p.split("/")[0] === col).sort()
    .map((p) => ({ id: p.split("/")[1], exists: true, data: () => store[p], metadata: {} })) });
  const avisar = (col) => setTimeout(() => (subs.get(col) || []).forEach((fn) => fn(foto(col))), 0);
  const copia = (d) => JSON.parse(JSON.stringify(d));
  const doc = (path) => ({
    id: path.split("/")[1], path,
    get: async () => ({ id: path.split("/")[1], exists: path in store, data: () => store[path] }),
    set: async (d) => { store[path] = copia(d); guardarTodo(); avisar(path.split("/")[0]); },
    update: async (d) => {
      if (!(path in store)) throw { code: "not_found", message: "El registro ya no existe." };
      store[path] = fusion(store[path], copia(d)); guardarTodo(); avisar(path.split("/")[0]);
    },
    delete: async () => { delete store[path]; guardarTodo(); avisar(path.split("/")[0]); },
  });
  const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // Archivos en IndexedDB; se precargan como URLs antes de mostrar los datos.
  const urls = new Map();
  const abrirIDB = () => new Promise((ok, mal) => {
    const r = indexedDB.open("censo.archivos", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("a");
    r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
  });
  const idb = abrirIDB().catch(() => null);
  const tx = async (modo, fn) => { const b = await idb; if (!b) throw { code: "sin_archivos", message: "Este navegador no permite guardar archivos." };
    return new Promise((ok, mal) => { const t = b.transaction("a", modo); const r = fn(t.objectStore("a")); t.oncomplete = () => ok(r?.result); t.onerror = () => mal(t.error); }); };
  const listo = idb.then(async (b) => {
    if (!b) return;
    await new Promise((ok) => { const t = b.transaction("a", "readonly"); const c = t.objectStore("a").openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur) return ok(); urls.set(cur.key, URL.createObjectURL(cur.value)); cur.continue(); };
      c.onerror = () => ok(); });
  });

  const db = {
    doc,
    collection: (col) => ({
      doc: (id) => doc(`${col}/${id || nuevoId()}`),
      onSnapshot: (next) => {
        if (!subs.has(col)) subs.set(col, new Set());
        subs.get(col).add(next);
        listo.then(() => next(foto(col)));
        return () => subs.get(col).delete(next);
      },
    }),
  };
  const yo = { id: "local", name: "Secretaría", canEdit: true, isOwner: true };
  const user = { me: async () => yo, can: async () => true, profiles: async (ids) => Object.fromEntries([].concat(ids).map((i) => [i, { id: i, name: "Secretaría" }])) };
  const downloads = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      return { status: "saved" };
    },
  };
  const assets = {
    upload: async (blob, op) => {
      const id = nuevoId() + nuevoId();
      const b = op?.type && blob.type !== op.type ? new Blob([blob], { type: op.type }) : blob;
      await tx("readwrite", (s) => s.put(b, id));
      urls.set(id, URL.createObjectURL(b));
      return { id, url: urls.get(id), sizeBytes: b.size, contentType: b.type };
    },
    delete: async (id) => { await tx("readwrite", (s) => s.delete(id)); urls.delete(id); return { deleted: true }; },
    list: async () => ({ assets: [], usage: {} }),
  };
  window.claude = {
    use: (nombre) => Promise.resolve({ db, user, downloads, assets }[nombre] || null),
    urlArchivo: (id) => urls.get(id) || null,
  };
})();
