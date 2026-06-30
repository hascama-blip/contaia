import Link from "next/link";

// Pantalla cuando el estudio no tiene desbloqueado un módulo de paga.
export function ModuloBloqueado({ nombre }: { nombre: string }) {
  return (
    <div className="mx-auto max-w-lg">
      <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
      <div className="card mt-3 grid place-items-center gap-3 p-10 text-center">
        <span className="text-4xl">🔒</span>
        <h1 className="text-xl font-bold text-slate-800">{nombre}</h1>
        <p className="text-sm text-slate-500">
          Este módulo es de <b>paga</b> y aún no está habilitado para tu cuenta.
          Solicítalo al administrador de la plataforma para desbloquearlo.
        </p>
      </div>
    </div>
  );
}
