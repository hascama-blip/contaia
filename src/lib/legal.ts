// ============================================================
//  Políticas que el usuario acepta (registro y primer ingreso)
// ============================================================
// Módulo PURO (solo texto): lo usan el middleware, la página /legal, el
// registro y la pantalla /aceptar.
//
// ⚠️ Si cambias el TEXTO de forma sustancial, sube TERMINOS_VERSION: todos los
// usuarios deberán aceptarlo de nuevo en su próximo ingreso (queda evidencia
// de cada versión aceptada con fecha, IP y huella del texto).

export const TERMINOS_VERSION = "2026-11-07";

/** Empresa titular de la plataforma (configurable por entorno). */
export function titularLegal(): { nombre: string; ruc: string; correo: string } {
  return {
    nombre: (process.env.LEGAL_TITULAR || "KALLPA GREEN").trim(),
    ruc: (process.env.LEGAL_RUC || "").trim(),
    correo: (process.env.LEGAL_CORREO || "").trim(),
  };
}

export interface SeccionLegal { titulo: string; parrafos: string[] }
export interface DocumentoLegal { id: "seguridad" | "responsabilidad"; titulo: string; resumen: string; secciones: SeccionLegal[] }

export function documentosLegales(): DocumentoLegal[] {
  const t = titularLegal();
  const titular = `${t.nombre}${t.ruc ? ` (RUC ${t.ruc})` : ""}`;
  const contacto = t.correo ? ` al correo ${t.correo}` : " por los canales de atención publicados en la plataforma";
  return [
    {
      id: "seguridad",
      titulo: "Política de seguridad y uso aceptable",
      resumen: "Cómo debes cuidar tu cuenta y las credenciales tributarias, y qué usos están prohibidos.",
      secciones: [
        {
          titulo: "1. Objeto",
          parrafos: [
            `Radar Tributar IA (en adelante, "la Plataforma") es una herramienta tecnológica de ${titular} que permite a contadores, estudios contables y empresas consultar y ordenar información tributaria de los contribuyentes que les han encargado su atención. Esta política regula el uso seguro de la Plataforma y es obligatoria para toda persona que tenga una cuenta, incluidos los sub-usuarios (operadores) creados por un estudio.`,
          ],
        },
        {
          titulo: "2. Cuenta personal e intransferible",
          parrafos: [
            "La cuenta es personal. No debes compartir tu contraseña ni los códigos de verificación con nadie, ni permitir que otra persona ingrese con tu cuenta. Todo lo que se haga con tu cuenta se presume hecho por ti.",
            "Debes usar una contraseña propia y segura, cerrar la sesión en equipos compartidos y avisarnos de inmediato si sospechas que alguien conoce tu contraseña o usó tu cuenta.",
            "El titular de un estudio responde por los operadores que crea: debe darles acceso solo a lo necesario y retirarlo cuando dejen de trabajar con él.",
          ],
        },
        {
          titulo: "3. Credenciales tributarias de terceros",
          parrafos: [
            "Solo puedes registrar y usar el RUC, el usuario SOL, la Clave SOL y las credenciales del API SUNAT de contribuyentes que te hayan autorizado expresamente a hacerlo, y solo mientras esa autorización esté vigente.",
            "La Clave SOL no se almacena en la Plataforma, salvo que actives el seguimiento automático del buzón, en cuyo caso se guarda cifrada y solo para ese fin. El client_secret del API SUNAT se guarda cifrado. Puedes eliminar estas credenciales en cualquier momento.",
            "Cuando termine tu relación profesional con un contribuyente, debes eliminarlo de la Plataforma (o quitar sus credenciales) y dejar de consultar su información.",
          ],
        },
        {
          titulo: "4. Usos prohibidos",
          parrafos: [
            "Está prohibido: (a) acceder o intentar acceder a información de contribuyentes que no te autorizaron o que ya no te autorizan; (b) usar la información obtenida para fines distintos al servicio profesional encargado, como competir deslealmente, presionar, extorsionar, perjudicar o divulgar datos del contribuyente; (c) vender, ceder o publicar información tributaria de terceros; (d) vulnerar, probar o eludir la seguridad de la Plataforma o de SUNAT; (e) usar procesos automatizados ajenos a la Plataforma para extraer información de ella.",
            "Estas conductas pueden constituir infracciones a la reserva tributaria, al secreto profesional, a la Ley N.° 29733 de Protección de Datos Personales y delitos de la Ley N.° 30096 de Delitos Informáticos, entre otras normas.",
          ],
        },
        {
          titulo: "5. Medidas de seguridad de la Plataforma",
          parrafos: [
            "La Plataforma usa conexión cifrada (HTTPS), contraseñas almacenadas con función de derivación segura, verificación de correo, límites de intentos, cifrado de los secretos guardados, aislamiento de datos entre estudios, copias de respaldo y registro de accesos. Ninguna medida es infalible: tú también eres responsable de proteger tu cuenta.",
          ],
        },
        {
          titulo: "6. Incumplimiento",
          parrafos: [
            "Ante un uso contrario a esta política, o un reclamo fundado de un contribuyente, la Plataforma podrá suspender o cerrar la cuenta sin derecho a reembolso del periodo en curso, conservar la evidencia y ponerla a disposición de las autoridades competentes o del contribuyente afectado, conforme a ley.",
          ],
        },
      ],
    },
    {
      id: "responsabilidad",
      titulo: "Declaración de responsabilidad y consentimiento de registro de accesos",
      resumen: "Declaras que tienes autorización de cada contribuyente, que eres el único responsable del uso de su información y aceptas que registremos tus accesos.",
      secciones: [
        {
          titulo: "1. Autorización de los contribuyentes",
          parrafos: [
            "Declaro bajo mi responsabilidad que cuento con la autorización expresa, previa y vigente de cada contribuyente cuyo RUC y credenciales registro en la Plataforma, y que la mantendré vigente mientras use su información. Me comprometo a acreditarla si me es requerida.",
          ],
        },
        {
          titulo: "2. Responsabilidad exclusiva del usuario",
          parrafos: [
            `Reconozco que la Plataforma es solo una herramienta tecnológica: ${titular} no decide qué contribuyentes se consultan, no conoce la relación entre el usuario y sus clientes y no tiene control sobre el uso que el usuario dé a la información obtenida. Respecto de la información de mis clientes, actúo como responsable de su tratamiento y la Plataforma como encargada, por mi cuenta y siguiendo mis instrucciones.`,
            "En consecuencia, soy el único responsable, civil, administrativa y penalmente, por el acceso a la información de los contribuyentes que registro y por el uso que dé a dicha información, incluido el uso posterior al término de mi relación profesional con ellos.",
          ],
        },
        {
          titulo: "3. Exoneración e indemnidad",
          parrafos: [
            `Libero a ${titular}, a sus representantes, desarrolladores y personal de toda responsabilidad por daños, reclamos, denuncias, quejas, procedimientos o sanciones que se originen en el uso que yo, o los operadores de mi estudio, hagamos de la Plataforma o de la información obtenida con ella sin autorización del contribuyente o para fines distintos a los autorizados.`,
            `Me obligo a mantener indemne a ${titular} frente a cualquier reclamo, denuncia o procedimiento de terceros (incluidos contribuyentes, SUNAT u otras autoridades) derivado de dichos actos, y a asumir los gastos, honorarios de defensa, multas e indemnizaciones que resulten, en la medida permitida por la ley.`,
          ],
        },
        {
          titulo: "4. Registro de accesos (consentimiento)",
          parrafos: [
            "Acepto y autorizo que la Plataforma registre de forma automática mis accesos y operaciones, incluidos: fecha y hora, dirección IP, navegador y dispositivo, cuenta utilizada, inicios de sesión (exitosos y fallidos), y las acciones que realizo sobre cada contribuyente (RUC y razón social, consultas, extracciones, descargas, registro o eliminación de credenciales).",
            "La finalidad de este registro es la seguridad de la Plataforma, la prevención y detección de accesos no autorizados o usos indebidos, y la acreditación de quién realizó cada operación. Cada registro se firma digitalmente para detectar alteraciones.",
            "Autorizo que estos registros se conserven por un plazo de hasta cinco (5) años y que sean utilizados como medio de prueba y entregados a las autoridades administrativas, fiscales o judiciales competentes, o al contribuyente afectado, cuando exista un requerimiento conforme a ley o sea necesario para el ejercicio o la defensa de derechos de la Plataforma o de terceros.",
          ],
        },
        {
          titulo: "5. Datos personales del usuario",
          parrafos: [
            `${titular} trata mis datos de cuenta (nombre, correo, registros de acceso y de pago) para prestar el servicio, su seguridad y las finalidades indicadas en este documento, conforme a la Ley N.° 29733 y su reglamento. Puedo ejercer mis derechos de acceso, rectificación, cancelación y oposición${contacto}. La cancelación de la cuenta no elimina los registros de acceso mientras dure el plazo de conservación del punto 4, por ser necesarios para la defensa de derechos.`,
          ],
        },
        {
          titulo: "6. Aceptación",
          parrafos: [
            "Al marcar la casilla de aceptación declaro haber leído este documento y la Política de seguridad y uso aceptable, y los acepto. La Plataforma guarda constancia de mi aceptación con la fecha, la hora, la dirección IP, el navegador y la versión del texto aceptado. Si el texto cambia de forma sustancial, se me pedirá aceptarlo nuevamente.",
          ],
        },
      ],
    },
  ];
}

/** Texto plano de los documentos (para calcular la huella de lo aceptado). */
export function textoLegalPlano(): string {
  return documentosLegales()
    .map((d) => [d.titulo, ...d.secciones.flatMap((s) => [s.titulo, ...s.parrafos])].join("\n"))
    .join("\n\n");
}
