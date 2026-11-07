"use client";

// Las dos casillas obligatorias (registro y pantalla /aceptar). Los enlaces
// abren /legal en otra pestaña para no perder lo escrito en el formulario.
export default function CasillasPoliticas({
  seguridad, responsabilidad, onSeguridad, onResponsabilidad,
}: {
  seguridad: boolean; responsabilidad: boolean;
  onSeguridad: (v: boolean) => void; onResponsabilidad: (v: boolean) => void;
}) {
  const caja = "mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500";
  const enlace = "font-semibold text-brand-600 hover:underline";
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
      <label className="flex cursor-pointer gap-2">
        <input type="checkbox" className={caja} checked={seguridad} onChange={(e) => onSeguridad(e.target.checked)} required />
        <span>
          He leído y acepto la{" "}
          <a href="/legal#seguridad" target="_blank" rel="noopener" className={enlace}>Política de seguridad y uso aceptable</a>.
        </span>
      </label>
      <label className="flex cursor-pointer gap-2">
        <input type="checkbox" className={caja} checked={responsabilidad} onChange={(e) => onResponsabilidad(e.target.checked)} required />
        <span>
          Declaro que cuento con autorización de cada contribuyente que registre, que soy el único responsable del uso de su
          información, y acepto el registro de mis accesos (fecha, IP, dispositivo y RUC consultados), según la{" "}
          <a href="/legal#responsabilidad" target="_blank" rel="noopener" className={enlace}>Declaración de responsabilidad</a>.
        </span>
      </label>
    </div>
  );
}
