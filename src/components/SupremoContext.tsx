"use client";

import { createContext, useContext } from "react";

// ¿La sesión actual es del usuario supremo? Lo usan los paneles para mostrar
// el "Modo diagnóstico" solo a él.
const SupremoCtx = createContext(false);

export function SupremoProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  return <SupremoCtx.Provider value={value}>{children}</SupremoCtx.Provider>;
}

/** true solo si el usuario es supremo → puede ver el Modo diagnóstico. */
export function usePuedeDiag(): boolean {
  return useContext(SupremoCtx);
}
