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
  columna `edad` del reporte;
- **cuánto se pagará**: importe del beneficio por asociado y totales por mes,
  sexo y departamento (selector "Medida en gráficos": personas o S/).

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

## Importe del beneficio

- Si el reporte trae el importe calculado por AMSP (`impben`, asociados que ya
  clasifica en edad de jubilación a los 70) se usa tal cual ("Oficial AMSP").
- Para el resto se estima con la escala de beneficios reconstruida a partir de
  esos importes oficiales (`TABLA_BENEFICIO` en `plantilla.html`): tabla por
  años completos de aporte y escala. ESCALA 2017 cuota 18 → S/ 8,040 con 45
  años (tope); cuota 12 → S/ 5,225 con 41 años; ESCALA 98 → tope S/ 6,000 con
  30 años. Pasados a 1% UIT: tabla completa de la escala anterior si no hay
  fecha de cambio (`anivapofc`); con fecha de cambio, 25 % de esa tabla +
  devolución de cuotas 1% UIT (solo devolución con menos de 18 meses); nuevos
  asociados 1% UIT: devolución de cuotas.
- Años de aporte = meses desde `ingreso` hasta la fecha de jubilación menos la
  brecha mediana observada (meses no aportados) por `estasep` y cohorte de
  ingreso (`BRECHA*` en la plantilla, calibradas con el reporte del
  09/10/2026). El dashboard muestra la calibración: sobre los 1,425 importes
  oficiales el estimador da +2.5 % en total y la mitad de los casos difiere
  menos de S/ 210.
- Si AMSP cambia la escala, basta actualizar `TABLA_BENEFICIO`.

> El HTML generado contiene datos personales del padrón (nombres, DNI, fechas
> de nacimiento). No publicarlo en la carpeta `public/` ni en un sitio sin
> autenticación.
