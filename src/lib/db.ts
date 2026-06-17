import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type {
  Cliente,
  Documento,
  Diagnostico,
  SunatInfo,
  SireResumen,
  BuzonResumen,
  DeclaracionMensual,
} from "./types";

// Almacenamiento simple basado en un único archivo JSON.
// Suficiente para un MVP de un solo proceso; sustituible por una BD real
// (Postgres/SQLite) implementando la misma interfaz.

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

interface Store {
  clientes: Cliente[];
}

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

async function readStore(): Promise<Store> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    const store = JSON.parse(raw) as Store;
    // Compatibilidad: clientes creados antes de SIRE/buzón no tienen el campo.
    for (const c of store.clientes) {
      if (!Array.isArray(c.sire)) c.sire = [];
      if (c.buzon === undefined) c.buzon = null;
      if (!Array.isArray(c.declaraciones)) c.declaraciones = [];
    }
    return store;
  } catch {
    return { clientes: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  await ensureDirs();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function listClientes(): Promise<Cliente[]> {
  const store = await readStore();
  return store.clientes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getCliente(id: string): Promise<Cliente | null> {
  const store = await readStore();
  return store.clientes.find((c) => c.id === id) ?? null;
}

export async function createCliente(data: {
  razonSocial: string;
  ruc: string;
  email: string;
  telefono: string;
  sunat?: SunatInfo | null;
}): Promise<Cliente> {
  const store = await readStore();
  const cliente: Cliente = {
    id: newId(),
    razonSocial: data.razonSocial.trim(),
    ruc: data.ruc.trim(),
    email: data.email.trim(),
    telefono: data.telefono.trim(),
    createdAt: new Date().toISOString(),
    sunat: data.sunat ?? null,
    documentos: [],
    diagnostico: null,
    sire: [],
    buzon: null,
    declaraciones: [],
  };
  store.clientes.push(cliente);
  await writeStore(store);
  return cliente;
}

export async function updateCliente(
  id: string,
  patch: Partial<Pick<Cliente, "razonSocial" | "ruc" | "email" | "telefono">>
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === id);
  if (!cliente) return null;
  Object.assign(cliente, patch);
  await writeStore(store);
  return cliente;
}

export async function deleteCliente(id: string): Promise<boolean> {
  const store = await readStore();
  const before = store.clientes.length;
  store.clientes = store.clientes.filter((c) => c.id !== id);
  if (store.clientes.length === before) return false;
  await writeStore(store);
  return true;
}

export async function setSunatInfo(
  clienteId: string,
  sunat: SunatInfo
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.sunat = sunat;
  await writeStore(store);
  return cliente;
}

export async function addDocumento(
  clienteId: string,
  doc: Documento
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.documentos.push(doc);
  await writeStore(store);
  return cliente;
}

export async function updateDocumento(
  clienteId: string,
  docId: string,
  patch: Partial<Documento>
): Promise<Documento | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  const doc = cliente.documentos.find((d) => d.id === docId);
  if (!doc) return null;
  Object.assign(doc, patch);
  await writeStore(store);
  return doc;
}

export async function setSireResumen(
  clienteId: string,
  resumen: SireResumen
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  if (!Array.isArray(cliente.sire)) cliente.sire = [];
  // Reemplaza el resumen del mismo periodo si ya existía.
  cliente.sire = cliente.sire.filter((s) => s.periodo !== resumen.periodo);
  cliente.sire.push(resumen);
  cliente.sire.sort((a, b) => b.periodo.localeCompare(a.periodo));
  await writeStore(store);
  return cliente;
}

export async function addDeclaracion(
  clienteId: string,
  decl: DeclaracionMensual
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  if (!Array.isArray(cliente.declaraciones)) cliente.declaraciones = [];
  // Reemplaza la declaración del mismo periodo si ya existía.
  cliente.declaraciones = cliente.declaraciones.filter((d) => d.periodo !== decl.periodo);
  cliente.declaraciones.push(decl);
  cliente.declaraciones.sort((a, b) => b.periodo.localeCompare(a.periodo));
  await writeStore(store);
  return cliente;
}

export async function deleteDeclaracion(
  clienteId: string,
  declId: string
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.declaraciones = (cliente.declaraciones ?? []).filter((d) => d.id !== declId);
  await writeStore(store);
  return cliente;
}

export async function setBuzon(
  clienteId: string,
  buzon: BuzonResumen
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.buzon = buzon;
  await writeStore(store);
  return cliente;
}

export async function setDiagnostico(
  clienteId: string,
  diagnostico: Diagnostico
): Promise<Cliente | null> {
  const store = await readStore();
  const cliente = store.clientes.find((c) => c.id === clienteId);
  if (!cliente) return null;
  cliente.diagnostico = diagnostico;
  await writeStore(store);
  return cliente;
}
