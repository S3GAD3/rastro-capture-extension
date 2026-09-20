# Historial de cambios

## 0.4.0 — 2026-09-20

Rediseño de la captura, la extracción y la exportación. Verificado con 23 pruebas unitarias y 63 comprobaciones end-to-end en Chromium real (`npm run test:e2e`).

### Corregido
- **Página completa en Instagram/TikTok capturaba solo la ventana visible** cuando el scroll está en un contenedor interno. Ahora se detecta el contenedor real (ventana o elemento) y se unen todos los tramos.
- **Recursos falsos**: un `og:video` o `twitter:image` vacío se convertía en la URL de la propia página y aparecía como «vídeo directo».
- **Carruseles**: solo se veían las miniaturas cargadas en el DOM. Ahora se obtienen todas las diapositivas en máxima resolución.
- **Vídeos de Instagram por tramos** (`bytestart/byteend`): se pide el fichero completo y se rechazan MP4 incompletos (comprobación estructural de cajas `moov/moof`).
- **Nombres duplicados** en el ZIP (mismo usuario, mismo índice en publicaciones distintas) corrompían el paquete. Todo archivo lleva ahora un código correlativo `EV-0001`.
- **MHTML** no se guardaba en el expediente ni tenía hash; ahora es una evidencia más.
- La lista de evidencias cargaba todos los blobs en memoria en cada refresco; ahora los metadatos y el contenido están separados (IndexedDB v3, con migración automática desde v0.3.0).
- La captura mezclaba pestañas si el usuario cambiaba de pestaña a mitad; ahora se comprueba la pestaña activa y la URL en cada tramo.

### Añadido
- **Recolector pasivo** (`src/page/hook.js`): lee las respuestas JSON que la propia página recibe de Instagram/TikTok (publicaciones, perfiles, cuentas) sin hacer peticiones propias. Se complementa con el JSON embebido en la página.
- **Perfiles**: ficha de cuenta, listado de publicaciones, «Cargar más contenido» (auto-scroll cancelable), selección, descarga masiva de imágenes y vídeos y modo lote «abrir y capturar cada publicación».
- Capturas muy largas se dividen automáticamente en partes (sin límite de 28 000 px).
- Descarga con progreso, validación de firma y estructura, cabeceras HTTP guardadas, deduplicación por publicación y `Referer` correcto para los CDN de TikTok/Instagram.
- **Exportación**: recalcula y compara el SHA-256 de cada archivo, e incluye `INFORME.html` (imprimible, con ficha de cada publicación, cuenta, galería de medios, huellas y registro de actividad), `MANIFEST.json` (esquema 2), `evidencias.csv`, `publicaciones.csv`, `registro-actividad.csv`, `SHA256SUMS.txt` y `LEEME-VERIFICACION.txt`.
- Campos de investigador y unidad, registro de actividad (cadena de custodia), entorno de captura (navegador, zona horaria) y fecha UTC + local.
- Permiso opcional «acceder a todos los sitios» (necesario para capturar tras navegar o en webs distintas de Instagram/TikTok).

### Seguridad
- El informe HTML escapa todo contenido de terceros y lleva una política CSP sin scripts; los CSV neutralizan inyección de fórmulas.

## 0.3.0 — 2026-09-19

- Las capturas visible, de publicación y de página completa se descargan automáticamente como PNG en `Descargas/RASTRO-CAPTURE`.
- La ruta real de descarga queda registrada y visible dentro de cada evidencia.
- La pestaña objetivo se fija por su identificador durante toda la captura para evitar cambios de contexto.
- Sustituido `getDisplayMedia` por la API de extensiones `desktopCapture`, con selector limitado a pestañas y audio opcional.
- Añadidos mensajes de error operativos y comprobación de capturas vacías.
- Conservado el logotipo oficial del Kit RASTRO en panel, grabador e iconos.

## 0.2.0 — 2026-09-19

- Sustituida la grabación desde el panel lateral por una ventana dedicada que usa el selector nativo de pestañas y vuelve automáticamente a la pestaña objetivo.
- La grabación se finaliza y guarda también al pulsar **Dejar de compartir** en el navegador.
- Añadida vista previa, ruta de descarga y SHA-256 en la ventana del grabador.
- Los vídeos descargados se validan por su firma binaria; ya no se renombran respuestas HTML, JSON o segmentos como `.mp4`.
- Eliminada la descarga de respaldo que podía producir archivos no reproducibles.
- Incluidos en el paquete los módulos internos de ZIP y SHA-256 que faltaban en 0.1.2.
- Logotipo completo del Kit RASTRO visible en el panel y en el grabador.

## 0.1.2 — 2026-09-19

- La grabación captura directamente la pestaña web activa mediante `tabCapture.capture()` y no el panel lateral.
- Eliminado el selector de pantalla que podía elegir la superficie de RASTRO.
- Añadidos permisos de sitio limitados a Instagram y TikTok para que el análisis siga funcionando al navegar por perfiles y publicaciones.
- Añadido tiempo máximo de respuesta y mensajes de error visibles para el análisis.
- El indicador de grabación muestra el dominio que se está capturando.

## 0.1.1 — 2026-09-19

- Sustituido el inicio mediante `tabCapture`, que podía fallar desde el panel lateral, por el selector nativo de Chromium.
- Mensajes de error específicos para cancelación, permisos y pestañas no disponibles.
- Indicador visible de grabación y cronómetro.
- Confirmación de la ruta de descarga al finalizar.
- La grabación WebM se conserva en `Descargas/RASTRO-CAPTURE` y dentro del expediente exportable.
- Eliminados permisos y documento auxiliar de grabación que ya no eran necesarios.

## 0.1.0 — 2026-09-19

- Primera versión operativa.
- Panel lateral institucional RASTRO.
- Extractores específicos de Instagram y TikTok.
- Captura visible, de publicación y de página completa.
- Detección y adquisición local de imágenes y vídeos directos.
- Detección de recursos HLS/DASH.
- Grabación de pestaña con audio.
- Guardado MHTML.
- Expediente local, SHA-256, informe HTML y paquete ZIP verificable.
