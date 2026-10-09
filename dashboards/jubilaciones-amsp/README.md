# Dashboard de jubilaciones — padrón AMSP

Dashboard HTML interactivo (un solo archivo, sin servidor) que toma el
**Reporte Control Maestra Estatus** de la Asociación Mutualista Sanitaria del
Perú (hoja `DetMaeSituAct`) y responde:

- cuántos asociados cumplen la edad de jubilación **el próximo mes**
  (mujeres 65 / hombres 70, ajustable), con detalle nominal;
- cuántos la cumplen en los próximos 6 / 12 / 18 / 24 / 36 meses, mes a mes,
  por sexo y por departamento;
- cuántos **ya** tienen la edad de jubilación a la fecha de corte;
- verificación: edad recalculada con `fecnac` y la fecha de corte vs la
  columna `edad` del reporte.

## Archivos

| Archivo | Para qué |
|---|---|
| `jubilaciones-amsp.html` | Dashboard generado con los datos del reporte (abrir en el navegador). |
| `plantilla.html` | Plantilla sin datos (marcador `/*__DATOS__*/`). |
| `build.py` | Genera el HTML a partir de un reporte `.xlsx` (requiere `openpyxl`). |

## Regenerar con un reporte nuevo

Dos caminos, el primero no necesita nada instalado:

1. **Desde el navegador**: abrir `jubilaciones-amsp.html` → botón
   **Cargar otro reporte (.xlsx)** → elegir el Excel nuevo. Se recalcula todo
   al instante (la primera vez descarga la librería SheetJS desde cdnjs).
2. **Desde la terminal** (deja un HTML nuevo con los datos incrustados):

   ```bash
   pip install openpyxl
   python3 dashboards/jubilaciones-amsp/build.py Reporte_Control_MaestraEstatusYYYYMMDD.xlsx
   ```

## Criterio de cálculo

- Edad = años cumplidos entre `fecnac` y la fecha de corte (por defecto, hoy;
  editable en el filtro).
- Fecha de jubilación = `fecnac` + 65 años (F) o + 70 años (M). Nacidos un
  29/02 cumplen el 28/02 en años no bisiestos.
- "Próximo mes" = mes calendario siguiente al de la fecha de corte.
- El reporte AMSP clasifica con 70 años para ambos sexos (`dscann70`); el
  dashboard aplica 65/70 y la columna *Clasif. AMSP* queda como referencia.

> El HTML generado contiene datos personales del padrón (nombres, DNI, fechas
> de nacimiento). No publicarlo en la carpeta `public/` ni en un sitio sin
> autenticación.
