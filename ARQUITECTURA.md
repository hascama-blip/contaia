# Diagnóstico de arquitectura — Radar Tributar IA

Fecha: julio 2026. Estado evaluado: Next.js 14 monolito en Render (Standard, 2 GB) + disco persistente.

## Veredicto

**El monolito Next.js está BIEN para esta etapa y NO conviene separar físicamente
frontend y backend hoy.** Lo que sí era un riesgo real —el trabajo pesado
(navegadores headless) corriendo junto al servidor web— ya quedó aislado con una
**cola global de navegadores** (`src/lib/navegador.ts`): la web nunca más compite
por RAM con las extracciones.

### Por qué el monolito está bien aquí

| Aspecto | Situación |
|---|---|
| Separación lógica FE/BE | **Ya existe**: React (componentes) vs API routes (`src/app/api/**`) + libs (`src/lib/**`). El frontend solo habla con el backend por HTTP/JSON. |
| Un deploy, un servicio | Menos costo (1 instancia), menos fallas (sin CORS, sin duplicar auth, sin versiones desincronizadas). |
| Almacenamiento | `data/store.json` exige **un solo proceso escritor**. Separar en 2 servicios hoy **rompería los datos**. |
| RAM | 2 servicios = 2 × Node base (~300 MB c/u). Separar hoy **sube** el consumo, no lo baja. |

Separar físicamente FE/BE se justifica recién cuando: (a) haya BD real (Postgres),
(b) más de ~200–500 usuarios activos, o (c) un equipo de varios devs trabajando en
paralelo. Ninguna aplica aún.

### El problema real (y su estado)

1. **Navegadores headless en el mismo proceso que la web** — cada Chromium pesa
   300–500 MB; varios a la vez tumbaban el proceso entero (web incluida).
   ✅ **Resuelto**: cola global (`MAX_NAVEGADORES`, default 2). Los excedentes
   esperan turno (máx. 2 min, cola máx. 12) con mensaje claro; cupo se libera al
   cerrar el navegador o a los 6 min (red de seguridad). La web queda protegida.
2. **Store JSON de archivo único** — no soporta escrituras concurrentes masivas ni
   varias instancias. ⏳ Aceptable hoy (disco persistente + pocos cientos de
   usuarios); **migrar a Postgres (Neon) antes de un lanzamiento masivo** (Fase 2).
3. **Scraping SUNAT (buzón/F36)** — pesado por naturaleza. ⏳ Mitigado con cola +
   cooldowns + cuotas. La vía de escala real es la **API oficial "Control de
   mensajes"** (`api-cpe.sunat.gob.pe/v1/contribuyente/controlmsg`, ya concedida en
   el token — falta la sub-ruta exacta, ver lab `/supremo/lab-buzon`).

## Hoja de ruta (en orden)

- **Fase 1 (hecha)**: plan Standard 2 GB · disco persistente (`/var/data`) · cola
  de navegadores · cooldowns/cuotas · flags ligeros + bloqueo de recursos.
- **Fase 2 (antes de crecer fuerte)**: migrar `db.ts` a **Postgres (Neon)** —
  `db.ts` ya es la única puerta a los datos, así que es un cambio contenido.
  Luego se puede escalar la web a varias instancias.
- **Fase 3 (si el volumen lo pide)**: extraer un **worker** de extracciones
  (proceso aparte que consume una cola de trabajos; la web solo encola y muestra
  estado). Esto es la separación que de verdad baja consumo — separar el
  *trabajo pesado*, no el frontend.
- **Fase 4 (opcional, a gran escala)**: frontend en CDN/Vercel + API aparte.
  Solo cuando Fases 2–3 estén hechas.

## Reglas operativas

- `MAX_NAVEGADORES` (env, default 2): subir a 3–4 solo si se sube a Pro (4 GB).
- El diagnóstico del supremo (`Probar conexión`) muestra `colaNavegadores`
  (activos / en cola / máximo).
- `npm run build` debe pasar antes de push; deploy = push a `main`.
