-- ============================================================
--  Radar Tributar IA — Script de Base de Datos (tablas iniciales)
--  Motor destino: PostgreSQL 15+ (Neon). Julio 2026.
--  Equivalencia 1:1 con el store JSON actual (ver ESTRUCTURA_BD.md).
--  La migración consiste en reimplementar src/lib/db.ts sobre estas tablas
--  e importar el backup JSON (/api/supremo/backup?solo=datos).
-- ============================================================

-- ---------- 1) USUARIOS (cuentas de acceso) ----------
CREATE TABLE usuarios (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  pass_hash         TEXT NOT NULL,                    -- scrypt (nunca texto plano)
  rol               TEXT NOT NULL DEFAULT 'admin'
                    CHECK (rol IN ('supremo','admin','operador')),
  parent_id         UUID REFERENCES usuarios(id) ON DELETE CASCADE, -- operador -> su admin
  estado            TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','aprobado','rechazado')),
  decidido_at       TIMESTAMPTZ,                      -- cuándo decidió el supremo
  modulos           TEXT[] NOT NULL DEFAULT '{}',     -- módulos de paga: m2,m3,m4
  reset_token_hash  TEXT,                             -- sha256 del token (un solo uso)
  reset_token_exp   TIMESTAMPTZ,
  usos_gratis_usados INT NOT NULL DEFAULT 0,          -- cuota gratis: 3 / 7 días
  usos_gratis_desde TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usuarios_parent ON usuarios(parent_id);

-- ---------- 2) CLIENTES (empresas de cada estudio) ----------
CREATE TABLE clientes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, -- estudio dueño
  razon_social  TEXT NOT NULL,
  ruc           CHAR(11) NOT NULL UNIQUE,             -- RUC único GLOBAL (anti-abuso)
  email         TEXT NOT NULL DEFAULT '',
  telefono      TEXT NOT NULL DEFAULT '',
  sunat         JSONB,                                -- SunatInfo (consulta RUC completa)
  diagnostico   JSONB,                                -- score + hallazgos + recomendaciones
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clientes_owner ON clientes(owner_id);

-- ---------- 3) CREDENCIALES API SIRE (sin Clave SOL) ----------
CREATE TABLE cred_sire (
  cliente_id    UUID PRIMARY KEY REFERENCES clientes(id) ON DELETE CASCADE,
  sol_user      TEXT NOT NULL,
  client_id     TEXT NOT NULL,
  client_secret TEXT NOT NULL,                        -- cifrar a nivel aplicación
  guardado_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- REGLA DE ORO: la Clave SOL NUNCA se guarda en ninguna tabla.

-- ---------- 4) SIRE: montos por periodo ----------
CREATE TABLE sire_resumenes (
  cliente_id          UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  periodo             CHAR(6) NOT NULL,               -- "YYYYMM"
  v_comprobantes      INT NOT NULL DEFAULT 0,
  v_base              NUMERIC(14,2) NOT NULL DEFAULT 0,
  v_igv               NUMERIC(14,2) NOT NULL DEFAULT 0,
  v_inafecto          NUMERIC(14,2) NOT NULL DEFAULT 0,
  v_total             NUMERIC(14,2) NOT NULL DEFAULT 0,
  c_comprobantes      INT NOT NULL DEFAULT 0,
  c_base              NUMERIC(14,2) NOT NULL DEFAULT 0,
  c_igv               NUMERIC(14,2) NOT NULL DEFAULT 0,
  c_inafecto          NUMERIC(14,2) NOT NULL DEFAULT 0,
  c_total             NUMERIC(14,2) NOT NULL DEFAULT 0,
  presentado_ventas   BOOLEAN NOT NULL DEFAULT false,
  presentado_compras  BOOLEAN NOT NULL DEFAULT false,
  fuente              TEXT NOT NULL DEFAULT 'oficial' CHECK (fuente IN ('oficial','simulado')),
  consultado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_id, periodo)
);

-- ---------- 5) SIRE: estado de presentación (consulta rápida) ----------
CREATE TABLE sire_estados (
  cliente_id         UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  periodo            CHAR(6) NOT NULL,
  presentado_ventas  BOOLEAN,                          -- NULL = sin dato
  presentado_compras BOOLEAN,
  consultado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_id, periodo)
);

-- ---------- 6) BUZÓN: mensajes extraídos ----------
CREATE TABLE buzon_mensajes (
  cliente_id    UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cod_mensaje   TEXT NOT NULL,                        -- id del mensaje en SUNAT
  fecha         TEXT NOT NULL DEFAULT '',             -- tal como lo entrega SUNAT
  asunto        TEXT NOT NULL DEFAULT '',
  tipo          TEXT NOT NULL DEFAULT '',             -- Fiscalización, Valor, Cobranza…
  nivel         TEXT NOT NULL DEFAULT 'otro' CHECK (nivel IN ('peligroso','urgente','otro')),
  origen        TEXT CHECK (origen IN ('notificaciones','mensajes')),
  adjuntos      INT NOT NULL DEFAULT 0,
  leido         BOOLEAN NOT NULL DEFAULT false,
  consultado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_id, cod_mensaje)
);

-- ---------- 7) BUZÓN: PDFs descargados (caché + trazabilidad) ----------
CREATE TABLE buzon_adjuntos (
  cliente_id            UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cod_mensaje           TEXT NOT NULL,
  archivo               TEXT NOT NULL,                -- nombre físico en uploads/
  nombre                TEXT NOT NULL,                -- nombre sugerido de descarga
  size                  INT NOT NULL DEFAULT 0,
  at                    TIMESTAMPTZ NOT NULL DEFAULT now(), -- primera descarga desde SUNAT
  descargada_at         TIMESTAMPTZ,                  -- última vez que alguien lo abrió
  descargado_por_id     UUID,
  descargado_por_nombre TEXT,
  PRIMARY KEY (cliente_id, cod_mensaje)
);

-- ---------- 8) BUZÓN: seguimiento (comentarios / plazos) ----------
CREATE TABLE buzon_seguimientos (
  cliente_id        UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cod_mensaje       TEXT NOT NULL,
  asunto            TEXT NOT NULL DEFAULT '',
  fecha             TEXT NOT NULL DEFAULT '',
  origen            TEXT CHECK (origen IN ('notificaciones','mensajes')),
  dias_atencion     INT NOT NULL DEFAULT 0,
  comentario        TEXT NOT NULL DEFAULT '',
  fecha_limite      TIMESTAMPTZ,
  atendido          BOOLEAN NOT NULL DEFAULT false,
  creado_por_id     UUID,
  creado_por_nombre TEXT,
  creado_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_id, cod_mensaje)
);

-- ---------- 9) DECLARACIONES MENSUALES (F-621) ----------
CREATE TABLE declaraciones_mensuales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id     UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  periodo        CHAR(6) NOT NULL,
  ruc            CHAR(11),
  formulario     TEXT,
  ventas_base    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ventas_igv     NUMERIC(14,2) NOT NULL DEFAULT 0,
  compras_base   NUMERIC(14,2) NOT NULL DEFAULT 0,
  compras_igv    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ventas_detalle JSONB,                               -- desglose por concepto
  compras_detalle JSONB,
  casillas       JSONB,                               -- todas las casillas detectadas
  fuente         TEXT NOT NULL DEFAULT 'pdf' CHECK (fuente IN ('pdf','manual')),
  archivo_nombre TEXT,
  no_presento    BOOLEAN NOT NULL DEFAULT false,      -- sale como NO PRESENTÓ en el informe
  cargado_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_decl_mensuales ON declaraciones_mensuales(cliente_id, periodo);

-- ---------- 10) DECLARACIONES ANUALES (F-710) ----------
CREATE TABLE declaraciones_anuales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id     UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  ejercicio      CHAR(4) NOT NULL,
  ruc            CHAR(11),
  razon_social   TEXT,
  formulario     TEXT,
  valores        JSONB NOT NULL DEFAULT '{}',         -- casilla (3 dígitos) -> monto
  fuente         TEXT NOT NULL DEFAULT 'pdf' CHECK (fuente IN ('pdf','manual')),
  archivo_nombre TEXT,
  cargado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, ejercicio)                      -- el mismo año se reemplaza
);

-- ---------- 11) DEUDAS (OCR de fotos / manuales) ----------
CREATE TABLE deudas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id     UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL DEFAULT '',
  seccion        TEXT,                                -- Valores, Autoliquidadas, …
  codigo_tributo TEXT,
  numero         TEXT,
  descripcion    TEXT NOT NULL DEFAULT '',
  monto          NUMERIC(14,2) NOT NULL DEFAULT 0,
  periodo        TEXT,
  entidad        TEXT,
  fuente         TEXT NOT NULL DEFAULT 'manual' CHECK (fuente IN ('ocr','manual')),
  ocr_texto      TEXT,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deudas_cliente ON deudas(cliente_id);

-- ---------- 12) FRACCIONAMIENTO F36 (estado + tablas extraídas) ----------
CREATE TABLE deudas_f36 (
  cliente_id    UUID PRIMARY KEY REFERENCES clientes(id) ON DELETE CASCADE,
  tablas        JSONB NOT NULL DEFAULT '[]',          -- [{pestana, headers[], filas[][]}]
  at            TIMESTAMPTZ,                          -- última extracción
  generado_at   TIMESTAMPTZ,
  nota          TEXT,                                 -- avisos de SUNAT (texto en rojo)
  num_pedido    TEXT,
  fecha_pedido  TEXT,
  estado        TEXT NOT NULL DEFAULT 'sin-pedido'
                CHECK (estado IN ('sin-pedido','en-proceso','listo','extraido','vencido')),
  estado_texto  TEXT,
  accion        TEXT,
  verificado_at TIMESTAMPTZ
);

-- ---------- 13) MEMORIA DE CLASIFICACIÓN (nivel plataforma) ----------
CREATE TABLE cuentas_proveedor (
  ruc            CHAR(11) PRIMARY KEY,
  razon_social   TEXT,
  rubro          TEXT,
  cuenta         TEXT NOT NULL,
  nombre_cuenta  TEXT,
  fuente         TEXT NOT NULL DEFAULT 'sugerido' CHECK (fuente IN ('aprendido','sugerido')),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rubros_proveedor (
  ruc          CHAR(11) PRIMARY KEY,
  razon_social TEXT,
  actividad    TEXT,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 14) BITÁCORA DE AUDITORÍA ----------
CREATE TABLE acciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  studio_id      UUID NOT NULL,                       -- admin dueño del estudio
  usuario_id     UUID NOT NULL,
  usuario_nombre TEXT NOT NULL,
  rol            TEXT CHECK (rol IN ('admin','operador')),
  area           TEXT NOT NULL,                       -- Buzón, Fraccionamiento, Cliente…
  accion         TEXT NOT NULL,                       -- verbo + objeto, legible
  cliente_id     UUID,
  cliente_nombre TEXT,
  detalle        TEXT
);
CREATE INDEX idx_acciones_studio ON acciones(studio_id, at DESC);

-- ---------- 15) RUC ÚNICO GLOBAL (anti cuentas falsas) ----------
CREATE TABLE rucs_registrados (
  ruc          CHAR(11) PRIMARY KEY,
  studio_id    UUID NOT NULL,
  cliente_id   UUID NOT NULL,
  owner_nombre TEXT,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 16) CONFIGURACIÓN DE PLATAFORMA ----------
CREATE TABLE config (
  clave TEXT PRIMARY KEY,                             -- p. ej. 'browser_ws_url'
  valor TEXT NOT NULL DEFAULT ''
);

-- ---------- Siembra mínima ----------
-- El usuario supremo lo siembra la aplicación al arrancar (ensureSupremo),
-- así que no se inserta aquí. Config vacía por defecto.
