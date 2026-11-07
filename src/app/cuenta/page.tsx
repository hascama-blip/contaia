import { redirect } from "next/navigation";

// El cambio de contraseña ya no se hace desde la cuenta: solo desde el portal de
// inicio de sesión ("Olvidé mi contraseña", con código al correo).
export default function Page() {
  redirect("/");
}
