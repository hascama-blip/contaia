import type {
  Cliente,
  Diagnostico,
  Hallazgo,
  NivelRiesgo,
} from "./types";
import { compararDeclaracionSire } from "./declaracion";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre",
];

function etiquetaPeriodo(periodo: string): string {
  if (!/^\d{6}$/.test(periodo)) return periodo;
  return `${MESES[Number(periodo.slice(4, 6)) - 1] ?? "?"} ${periodo.slice(0, 4)}`;
}

// ============================================================
//  Motor de diagnóstico tributario
// ============================================================
// Combina el estado SUNAT del contribuyente con los datos extraídos
// de los documentos para producir un puntaje de salud tributaria,
// hallazgos y recomendaciones.

const PESO_SEVERIDAD: Record<NivelRiesgo, number> = {
  bajo: 5,
  medio: 15,
  alto: 30,
  critico: 50,
};

export function generarDiagnostico(cliente: Cliente): Diagnostico {
  const hallazgos: Hallazgo[] = [];
  const recomendaciones: string[] = [];

  const sunat = cliente.sunat;

  // ---- Análisis del estado SUNAT -------------------------------------------
  if (!sunat) {
    hallazgos.push({
      tipo: "sunat",
      severidad: "medio",
      titulo: "Sin consulta SUNAT",
      detalle:
        "Aún no se ha consultado el estado del contribuyente en SUNAT. Ejecute la consulta para un diagnóstico completo.",
    });
    recomendaciones.push("Ejecutar la consulta SUNAT del cliente.");
  } else {
    const estado = sunat.estado.toUpperCase();
    const condicion = sunat.condicion.toUpperCase();

    if (estado !== "ACTIVO") {
      hallazgos.push({
        tipo: "sunat",
        severidad: estado.includes("BAJA") ? "critico" : "alto",
        titulo: `Estado del contribuyente: ${sunat.estado}`,
        detalle:
          "El contribuyente no se encuentra ACTIVO en SUNAT, lo que impide operar y emitir comprobantes con normalidad.",
      });
      recomendaciones.push(
        "Regularizar el estado del RUC ante SUNAT (reactivación / actualización de datos)."
      );
    }

    if (condicion !== "HABIDO") {
      hallazgos.push({
        tipo: "sunat",
        severidad: "alto",
        titulo: `Condición de domicilio: ${sunat.condicion}`,
        detalle:
          "La condición distinta de HABIDO genera restricciones (crédito fiscal, comprobantes) y es señal de riesgo ante fiscalización.",
      });
      recomendaciones.push(
        "Actualizar el domicilio fiscal y solicitar cambio de condición a HABIDO."
      );
    }

    if (!sunat.comprobanteElectronico) {
      hallazgos.push({
        tipo: "sunat",
        severidad: "medio",
        titulo: "No emite comprobantes electrónicos",
        detalle:
          "No figura como emisor electrónico. La emisión electrónica es obligatoria para la mayoría de regímenes.",
      });
      recomendaciones.push(
        "Afiliarse a la emisión electrónica de comprobantes (SEE-SOL / OSE)."
      );
    }

    if (estado === "ACTIVO" && condicion === "HABIDO") {
      hallazgos.push({
        tipo: "sunat",
        severidad: "bajo",
        titulo: "Situación registral correcta",
        detalle: "El contribuyente está ACTIVO y HABIDO en SUNAT.",
      });
    }
  }

  // ---- Consistencia declaración vs SIRE ------------------------------------
  const declaraciones = cliente.declaraciones ?? [];
  const sirePorPeriodo = new Map(cliente.sire.map((s) => [s.periodo, s]));

  if (declaraciones.length === 0) {
    hallazgos.push({
      tipo: "documento",
      severidad: "bajo",
      titulo: "Sin declaraciones cargadas",
      detalle:
        "Sube las declaraciones mensuales (PDF) para comparar lo declarado contra el SIRE.",
    });
    recomendaciones.push(
      "Cargar las declaraciones mensuales (Formulario 621) para cruzarlas con el SIRE."
    );
  }

  for (const dec of declaraciones) {
    const sire = sirePorPeriodo.get(dec.periodo) ?? null;
    if (!sire) continue;
    const comp = compararDeclaracionSire(dec, sire);
    const alertas = comp.filas.filter((f) => f.estado === "alerta");
    if (alertas.length > 0) {
      const detalle = alertas
        .map(
          (f) =>
            `${f.concepto}: declarado S/ ${f.declarado.toLocaleString("es-PE", { minimumFractionDigits: 2 })} vs SIRE S/ ${f.sire.toLocaleString("es-PE", { minimumFractionDigits: 2 })} (dif S/ ${f.diferencia.toLocaleString("es-PE", { minimumFractionDigits: 2 })})`
        )
        .join("; ");
      hallazgos.push({
        tipo: "consistencia",
        severidad: "alto",
        titulo: `Diferencias declaración vs SIRE — ${etiquetaPeriodo(dec.periodo)}`,
        detalle,
      });
      recomendaciones.push(
        `Revisar y conciliar la declaración de ${etiquetaPeriodo(dec.periodo)} con el SIRE (posible declaración sustitutoria/rectificatoria).`
      );
    }

    if (sunat && dec.ruc && dec.ruc !== sunat.ruc) {
      hallazgos.push({
        tipo: "consistencia",
        severidad: "medio",
        titulo: `RUC de la declaración no coincide — ${etiquetaPeriodo(dec.periodo)}`,
        detalle:
          "La declaración cargada tiene un RUC distinto al del cliente. Verificar que corresponda al contribuyente.",
      });
    }
  }

  // ---- Cálculo de puntaje ---------------------------------------------------
  let penalizacion = 0;
  for (const h of hallazgos) {
    if (h.severidad === "bajo" && h.tipo === "sunat") continue; // bajo positivo no penaliza
    penalizacion += PESO_SEVERIDAD[h.severidad];
  }
  const score = Math.max(0, Math.min(100, 100 - penalizacion));
  const nivelRiesgo = scoreANivel(score);

  if (recomendaciones.length === 0) {
    recomendaciones.push(
      "No se detectaron acciones urgentes. Mantener al día declaraciones y pagos."
    );
  }

  return {
    score,
    nivelRiesgo,
    hallazgos: hallazgos.sort(
      (a, b) => PESO_SEVERIDAD[b.severidad] - PESO_SEVERIDAD[a.severidad]
    ),
    recomendaciones: Array.from(new Set(recomendaciones)),
    generatedAt: new Date().toISOString(),
  };
}

function scoreANivel(score: number): NivelRiesgo {
  if (score >= 85) return "bajo";
  if (score >= 65) return "medio";
  if (score >= 40) return "alto";
  return "critico";
}
