# Historial de cambios

## 0.5.0 — 2026-11-15

Evolución de la 0.4.0: se conservan todas sus funciones de análisis, captura, descarga, perfiles, lote y grabación. Verificado con 49 pruebas unitarias y 150 comprobaciones end-to-end en Chromium real (las 67 de la 0.4.0 siguen pasando).

### Corregido
- **El botón Cancelar quedaba recortado** (barra de progreso de 8 px con desbordamiento oculto por una regla CSS duplicada): no se podía cancelar una operación larga.
- Evidencias sin contenido en el almacén se listaban en el informe como si estuvieran en el paquete; ahora constan como «contenido ausente» e incidencia.
- El registro del grabador usaba un formato distinto al del panel; unificado.
- La versión figuraba escrita a mano en varios archivos; ahora procede del manifest y una prueba impide que diverjan.
- Los errores de operación, cancelaciones y fallos de copia en Descargas no quedaban registrados; ahora constan como incidencias.
- Eliminado código muerto (`src/panel/stitch.js`, sin uso) y reglas CSS duplicadas.

### Añadido
- **Identidad**: logotipo oficial RASTRO CAPTURE en panel, grabador, visor, verificador e iconos. Tema institucional claro (azul marino, azul policial, blanco, gris).
- **Interfaz en cuatro secciones** (Captura, Evidencias, Informes, Configuración) con paneles plegables y cabecera de sesión.
- **Sesiones**: identificador único `RC-AAAAMMDD-HHMMSS-XXXXXX`, contador de evidencias, aviso al cambiar de referencia con evidencias de otro expediente, notas por evidencia.
- **Personalización institucional**: escudo (PNG, JPG, SVG rasterizado), unidad, dependencia, identificador profesional y lugar. Separada de los datos del expediente, que no se arrastran entre sesiones.
- **Dos informes**: técnico completo (nueve secciones) y resumido para diligencias, en HTML autónomo y PDF, con escudo en el encabezado y logotipo RASTRO en el pie, incrustados.
- **Procedencia de los datos**: automático, manual o inferido (con fundamento), en panel, informes y manifiesto.
- **Generador PDF propio** sin dependencias: A4, encabezado y pie en cada página, «Página n de N», tablas que repiten cabecera.
- **Visor de informes** con impresión, descarga HTML y descarga PDF.
- **Manifiesto esquema 3** (`metadatos/manifest.json`): sesión, método de captura, advertencias, clase original/captura/derivado, documentos del paquete e incidencias.
- **Paquete autocontenido**: `evidencias/`, `informes/`, `registros/`, `metadatos/`, `README_EVIDENCIAS.txt`.
- **SHA-256 del ZIP** en un archivo `.sha256` independiente.
- **Verificar integridad**: ZIP (STORE o DEFLATE), carpeta o archivos sueltos; seis estados; informe HTML de verificación; compatible con paquetes de la 0.4.0.
- **Comprobar hashes** de los archivos locales desde la sección Evidencias.
- Descarga: un reintento ante fallos transitorios y mensajes claros para 401, 403, 404, 410, 429 y 451.
- Configuración: espacio usado, qué permanece en el navegador, borrado selectivo y retirada del permiso general.

### Seguridad
- Política CSP explícita para las páginas de la extensión (solo scripts propios, sin `eval`, sin objetos).
- El service worker rechaza mensajes que no procedan de páginas de la propia extensión.
- Informes sin scripts, con CSP `default-src 'none'`, imágenes solo como `data:` y enlaces limitados a http(s) o al paquete. El visor los muestra en un marco sin permiso de scripts.
- Sin permisos nuevos respecto de la 0.4.0.

### Cambios de formato
- El paquete tiene nueva estructura y `MANIFEST.json` pasa a `metadatos/manifest.json` (esquema 3). El verificador sigue leyendo paquetes de la 0.4.0.
- El ZIP se llama `RASTRO_CAPTURE_<referencia>_<fecha>Z.zip`.

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
