import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { Cliente, Documento, Diagnostico, SunatInfo } from "./types";

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
    return JSON.parse(raw) as Store;
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
