// Contexto de la app: datos en vivo, derivados, usuario, navegación y avisos.
// (Cumple el papel del layout + SupremoContext de Radar.)
import { createContext, useContext } from "./html.js";

export const Contexto = createContext(null);

export function useApp() {
  return useContext(Contexto);
}
