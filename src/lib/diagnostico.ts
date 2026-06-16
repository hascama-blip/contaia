import type {
  Cliente,
  Diagnostico,
  Hallazgo,
  NivelRiesgo,
} from "./types";

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

  // ---- Análisis de documentos ----------------------------------------------
  const procesados = cliente.documentos.filter((d) => d.ocrStatus === "procesado");
  if (cliente.documentos.length === 0) {
    hallazgos.push({
      tipo: "documento",
      severidad: "bajo",
      titulo: "Sin documentos adjuntos",
      detalle: "No se han cargado documentos para análisis.",
    });
    recomendaciones.push(
      "Adjuntar comprobantes, declaraciones o notificaciones para enriquecer el diagnóstico."
    );
  }

  const palabrasDeuda = new Set<string>();
  let totalDeudaDetectada = 0;
  for (const doc of procesados) {
    for (const p of doc.extraccion.palabrasClave) palabrasDeuda.add(p);
    for (const d of doc.extraccion.deudas) totalDeudaDetectada += d;
  }

  const senalesCriticas = ["COACTIVO", "COACTIVA", "EMBARGO"].filter((k) =>
    palabrasDeuda.has(k)
  );
  if (senalesCriticas.length > 0) {
    hallazgos.push({
      tipo: "documento",
      severidad: "critico",
      titulo: "Indicios de cobranza coactiva / embargo",
      detalle: `Los documentos mencionan: ${senalesCriticas.join(", ")}. Requiere atención inmediata.`,
    });
    recomendaciones.push(
      "Revisar el expediente coactivo y evaluar fraccionamiento o pago para levantar medidas."
    );
  }

  if (palabrasDeuda.has("MULTA") || palabrasDeuda.has("INFRACCION")) {
    hallazgos.push({
      tipo: "documento",
      severidad: "alto",
      titulo: "Multas / infracciones detectadas",
      detalle: "Se detectaron referencias a multas o infracciones en los documentos.",
    });
    recomendaciones.push(
      "Evaluar gradualidad / subsanación de infracciones para reducir multas."
    );
  }

  if (totalDeudaDetectada > 0) {
    hallazgos.push({
      tipo: "documento",
      severidad: totalDeudaDetectada > 10000 ? "alto" : "medio",
      titulo: `Deuda estimada en documentos: S/ ${totalDeudaDetectada.toLocaleString("es-PE", { minimumFractionDigits: 2 })}`,
      detalle:
        "Monto agregado de posibles deudas detectadas por OCR. Verificar contra el buzón SOL.",
    });
  }

  // ---- Consistencia RUC ----------------------------------------------------
  const rucsDocs = procesados
    .map((d) => d.extraccion.ruc)
    .filter((r): r is string => Boolean(r));
  if (sunat && rucsDocs.length > 0) {
    const inconsistente = rucsDocs.some((r) => r !== sunat.ruc);
    if (inconsistente) {
      hallazgos.push({
        tipo: "consistencia",
        severidad: "medio",
        titulo: "RUC en documentos no coincide",
        detalle:
          "Algún documento contiene un RUC distinto al del cliente. Verificar que los comprobantes correspondan al contribuyente.",
      });
      recomendaciones.push("Validar que los documentos cargados pertenezcan al cliente correcto.");
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
