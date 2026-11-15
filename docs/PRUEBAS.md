# Relación de pruebas · RASTRO CAPTURE 0.5.0

Ejecutadas el 15-11-2026 con datos ficticios. Entorno: Node 22, Chromium 153 (Chrome for Testing) con Playwright, Linux.

## Resumen

| Bloque | Resultado |
|---|---|
| Pruebas unitarias (`npm test`) | 49 correctas, 0 fallidas |
| Pruebas end-to-end en Chromium real (`npm run test:e2e`) | 150 correctas, 0 fallidas |
| Referencia: e2e de la v0.4.0 antes de modificar nada | 67 correctas, 0 fallidas |

Las pruebas end-to-end cargan la extensión real contra un servidor local que **simula** Instagram, TikTok y una web genérica. No se han ejecutado contra las plataformas reales.

## Correspondencia con la lista de validación

| Nº | Comprobación | Cómo se ha verificado |
|---|---|---|
| 1 | Instalación correcta | Automática: carga como extensión descomprimida en Chromium (service worker activo, panel operativo), también desde el ZIP de entrega. |
| 2 | Conservación de funciones originales | Automática: las comprobaciones e2e de la 0.4.0 siguen pasando; prueba unitaria de presencia de todos los controles originales. |
| 3 | Captura de imágenes y contenido | Automática (réplicas locales). |
| 4 | Descarga sin corrupción | Automática: firma binaria, estructura MP4 y hash idéntico al fichero servido. |
| 5 | Hashes individuales correctos | Automática: comparación con `sha256sum` y con `node:crypto`. |
| 6 | ZIP sin errores | Automática: `unzip`, `sha256sum -c`. |
| 7 | Verificación posterior | Automática: verificador sobre ZIP, carpeta y archivos sueltos. |
| 8 | Archivos modificados | Automática: cambio de un bit, archivo borrado, archivo añadido, manifiesto alterado. |
| 9 | Logotipo RASTRO CAPTURE | Automática (carga de la imagen) y revisión visual de capturas de pantalla. |
| 10 | Carga del escudo institucional | Automática: PNG, SVG con script (rasterizado, sin ejecución) y archivo no válido. |
| 11 | Escudo en los informes | Automática: HTML y PDF. |
| 12 | Informe técnico | Automática: nueve secciones, contenido y enlaces. |
| 13 | Informe resumido | Automática. |
| 14 | HTML autónomo | Automática: apertura con `file://` sin ninguna petición de red ni infracción de CSP. |
| 15 | PDF sin cortes | PDF propio: automática (qpdf, paginación, cabeceras repetidas, texto dentro de márgenes) y revisión visual. Impresión del HTML desde el navegador: comprobada con Chromium sin interfaz (A4, «Página n de N») y revisión visual; **el diálogo de impresión en sí requiere comprobación manual**. |
| 16 | Datos automáticos, manuales e inferidos | Automática. |
| 17 | Gestión de sesiones | Automática. |
| 18 | Informes sin conexión | Automática (igual que 14). |
| 19 | Sin errores JavaScript | Automática en panel, visor y verificador. |
| 20 | Compatibilidad con navegadores | Solo Chromium 153. **Chrome estable, Edge, Brave y Opera requieren comprobación manual.** |

## Requiere comprobación manual

- **Grabador de pestaña**: usa el selector nativo del navegador, que no puede automatizarse. Su código de captura no se ha modificado respecto de la 0.4.0 (solo aspecto, registro y versión), pero no se ha ejecutado una grabación en estas pruebas.
- **Panel lateral nativo**: las pruebas abren `sidepanel.html` en una ventana; la apertura desde el icono no se automatiza.
- **Cuadros de permisos del navegador** («acceder a todos los sitios»): se simulan como concedidos.
- **Instagram y TikTok reales**, con sesión iniciada.
- **Chrome estable, Edge, Brave, Opera**.
- **Diálogo «Guardar como PDF»** del navegador y selector de archivos del escudo y del verificador (en las pruebas los archivos se inyectan directamente).

## Pruebas unitarias

- ✔ SHA-256 usa los bytes exactos
- ✔ el paquete ZIP conserva rutas y contenido
- ✔ el ZIP rechaza contenido alterado
- ✔ reconoce MP4 y WebM por firma, no por extensión
- ✔ distingue una imagen AVIF de un vídeo MP4
- ✔ rechaza HTML o JSON renombrado como vídeo
- ✔ el paquete contiene todos los módulos y páginas de ejecución
- ✔ SHA-256 incremental coincide con node:crypto en longitudes límite
- ✔ sha256Blob usa la ruta incremental por encima de 48 MB con el mismo resultado
- ✔ createZipBlob genera un ZIP válido sin duplicar contenido
- ✔ detecta MP4 incompleto (tramo parcial) y acepta uno con moov
- ✔ CSV neutraliza fórmulas y escapa separadores
- ✔ el informe escapa contenido de terceros y no admite enlaces javascript:
- ✔ nombres únicos por código y fechas locales con desplazamiento
- ✔ Instagram API moderna: carrusel con imagen y vídeo, orden y calidad máxima
- ✔ Instagram GraphQL clásica (shortcode_media) y perfil web_profile_info
- ✔ Instagram historia (sin shortcode)
- ✔ TikTok web: vídeo con bitrateInfo, mejor calidad y datos del autor
- ✔ TikTok perfil (userInfo) y publicación de fotos
- ✔ TikTok API móvil (aweme_detail)
- ✔ no inventa publicaciones a partir de JSON ajeno y no falla con estructuras profundas
- ✔ fusión: conserva las métricas conocidas y el conjunto de medios más completo
- ✔ caducidad de URL firmada
- ✔ manifiesto esquema 3: sesión, evidencias con todos los campos exigidos y clase original/derivado
- ✔ manifiesto: discrepancias de integridad, contenido ausente y mezcla de referencias constan como incidencias
- ✔ los datos manuales, automáticos e inferidos se separan en el manifiesto
- ✔ informe técnico: las nueve secciones, tabla de evidencias con hashes y logotipos incrustados
- ✔ informes autónomos: sin scripts, sin recursos externos y con CSP restrictiva
- ✔ informe: los datos llevan su procedencia y las inferencias su fundamento
- ✔ informe resumido: breve, con unidad, diligencias, recurso, operaciones, archivos, hashes, incidencias y paquete
- ✔ informe: el contenido de terceros y los campos manuales se escapan; los enlaces solo son http(s) o relativos al paquete
- ✔ una imagen incrustada no válida no llega al HTML
- ✔ PDF técnico y resumido: estructura válida, A4, paginación, encabezado institucional e imágenes incrustadas
- ✔ PDF: tablas largas repiten cabecera, no parten filas y el documento sigue siendo válido con 300 evidencias
- ✔ PDF: codificación WinAnsi, ajuste de líneas y lectura de JPEG
- ✔ verificador: paquete íntegro leído desde el ZIP (coincidencia correcta en todos los archivos)
- ✔ verificador: distingue hash diferente, archivo ausente, archivo adicional y error de lectura
- ✔ verificador: detecta la alteración de un solo byte en un informe y la del propio manifiesto
- ✔ verificador: manifiesto inválido o ausente, y paquete ilegible
- ✔ verificador: carpeta extraída sin carpeta raíz, archivos sueltos localizados por nombre y paquetes de la v0.4.0
- ✔ verificador: admite un ZIP recomprimido con DEFLATE y rechaza rutas peligrosas
- ✔ informe de verificación: autónomo, con resultado global, detalle y la advertencia sobre autenticidad
- ✔ README del paquete explica la organización, originales/derivados y los tres métodos de verificación
- ✔ descarga: reintenta una vez ante fallos transitorios y conserva los bytes recibidos sin transformar
- ✔ descarga: los 4xx no se reintentan y explican la limitación sin eludir controles de acceso
- ✔ versión única y permisos sin ampliar respecto de la v0.4.0
- ✔ CSP de las páginas de la extensión: solo scripts propios, sin eval ni objetos
- ✔ páginas de la extensión: sin scripts en línea, sin recursos remotos y con la identidad del proyecto
- ✔ código: sin eval, sin telemetría, sin acceso a cookies y sin dependencias externas

## Pruebas end-to-end

### Migración del expediente de v0.3.0 (IndexedDB v2 → v3)

- ✔ los registros antiguos conservan contenido y reciben código correlativo
- ✔ el tipo se deduce del registro antiguo
- ✔ el blob ya no va dentro del registro y el siguiente código continúa la serie

### Instagram · publicación (carrusel imagen + imagen + vídeo, scroll interno, vídeo blob:)

- ✔ el análisis termina sin error
- ✔ detecta plataforma, tipo y código de la publicación
- ✔ extrae usuario, fecha y hashtags desde los datos de la plataforma
- ✔ lista TODAS las diapositivas del carrusel (2 imágenes + vídeo + portada), sin duplicados ni URLs falsas
- ✔ no aparece la URL de la propia página como recurso
- ✔ el vídeo se ofrece sin bytestart/byteend (fichero completo)
- ✔ Descargar todo: 4 guardados y 0 errores
- ✔ las imágenes y el vídeo son archivos válidos con extensión y MIME reales
- ✔ cada archivo tiene código único y ruta ordenada por plataforma/usuario/publicación
- ✔ se guardan cabeceras HTTP y estructura MP4 de cada descarga
- ✔ se registra la ficha de análisis (JSON) de origen
- ✔ Página completa termina sin error
- ✔ se guarda al menos una imagen de página completa
- ✔ la captura mide todo el contenido del scroll interno (2976px ≈ 2976px, antes solo la ventana visible)
- ✔ el marcador verde del centro aparece UNA sola vez y con su altura exacta (sin huecos ni duplicados en la unión)
- ✔ el marcador rojo del final está presente (se llegó al fondo)
- ✔ la barra fija de login no queda repetida en la captura
- ✔ se registra la región, el modo de scroll y el número de tramos
- ✔ Publicación completa guarda el elemento detectado
- ✔ Vista visible guarda un PNG
- ✔ MHTML se guarda como evidencia con hash
- ✔ el MHTML tiene formato válido
- ✔ Guardar datos: JSON de origen embebido en la página
- ✔ el panel no produjo errores de JavaScript

### Interfaz · logotipo oficial, cuatro secciones, sesión activa y personalización institucional

- ✔ el logotipo oficial RASTRO CAPTURE se carga en la cabecera
- ✔ identidad «RASTRO CAPTURE — Kit RASTRO» y pie «Creado por S3GAD3»
- ✔ cuatro secciones: Captura, Evidencias, Informes y Configuración
- ✔ la sesión activa muestra identificador único y número de evidencias
- ✔ los datos de unidad e investigador de la v0.4.0 se adoptan como perfil institucional
- ✔ un SVG se rasteriza a PNG al cargarlo (nunca se guarda con contenido activo) y su script no se ejecuta
- ✔ un archivo que no es PNG, JPG ni SVG se rechaza con un mensaje claro
- ✔ el escudo institucional (PNG) se carga, se visualiza y puede cambiarse o eliminarse
- ✔ la configuración institucional y los datos del expediente se guardan por separado y en local
- ✔ la sección Evidencias lista cada archivo con tamaño, fecha, clase y SHA-256 completo
- ✔ se puede añadir una observación a una evidencia ya capturada
- ✔ «Comprobar hashes» recalcula el SHA-256 de todos los archivos locales y coincide

### Exportación del paquete de evidencias autocontenido

- ✔ la exportación verifica todos los hashes
- ✔ el nombre del paquete identifica la herramienta y la referencia
- ✔ el SHA-256 del ZIP se entrega en un archivo .sha256 independiente y coincide con los bytes del ZIP
- ✔ el ZIP contiene una única carpeta raíz con el nombre del paquete
- ✔ el paquete contiene README_EVIDENCIAS.txt
- ✔ el paquete contiene metadatos/manifest.json
- ✔ el paquete contiene metadatos/SHA256SUMS.txt
- ✔ el paquete contiene informes/informe_tecnico.html
- ✔ el paquete contiene informes/informe_resumido.html
- ✔ el paquete contiene informes/informe_tecnico.pdf
- ✔ el paquete contiene informes/informe_resumido.pdf
- ✔ el paquete contiene registros/actividad.json
- ✔ el paquete contiene registros/actividad.csv
- ✔ el paquete contiene registros/evidencias.csv
- ✔ no hay archivos fuera de evidencias/, informes/, registros/, metadatos/ y el README
- ✔ `sha256sum -c metadatos/SHA256SUMS.txt` valida todos los ficheros del paquete
- ✔ `sha256sum -c <paquete>.zip.sha256` valida el ZIP completo
- ✔ MANIFEST: esquema 3, sesión, caso, investigador, entorno y verificación de integridad
- ✔ MANIFEST: cada evidencia lleva origen (URL, plataforma, usuario) y fecha UTC + local
- ✔ MANIFEST: identificador, ruta relativa, tamaño, MIME, SHA-256, URL de origen, método, advertencias y clase de cada evidencia
- ✔ MANIFEST: declara los documentos derivados (informes, registros, README) con su hash
- ✔ los nombres de archivo del ZIP son únicos
- ✔ los 15 archivos del paquete son idénticos byte a byte a los capturados (sin modificar)
- ✔ las evidencias descargadas del servidor son los bytes originales del origen
- ✔ registros/actividad.json permite reconstruir la secuencia de operaciones
- ✔ README_EVIDENCIAS.txt explica la organización y el método de verificación
- ✔ el paquete no contiene cookies ni credenciales de la sesión del navegador
- ✔ informe_tecnico.html: se abre sin conexión, sin peticiones de red ni scripts, y cumple su CSP
- ✔ informe_tecnico.html: todas las imágenes van incrustadas (9) y se visualizan
- ✔ informe_tecnico.html: escudo institucional arriba y logotipo RASTRO CAPTURE en el pie
- ✔ informe_tecnico.html: muestra unidad, diligencias, sesión, hashes y observación manual
- ✔ informe técnico: nueve secciones en orden
- ✔ informe técnico: ficha de la publicación, hashtags, huellas y verificación
- ✔ informe técnico: separa datos automáticos, manuales e inferidos, y fundamenta las inferencias
- ✔ informe técnico: el anexo incluye vistas previas de capturas, imágenes y un fotograma del vídeo
- ✔ informe técnico: los 30 enlaces a los archivos originales apuntan a ficheros del paquete
- ✔ informe_resumido.html: se abre sin conexión, sin peticiones de red ni scripts, y cumple su CSP
- ✔ informe_resumido.html: todas las imágenes van incrustadas (2) y se visualizan
- ✔ informe_resumido.html: escudo institucional arriba y logotipo RASTRO CAPTURE en el pie
- ✔ informe_resumido.html: muestra unidad, diligencias, sesión, hashes y observación manual
- ✔ informe resumido: secciones de actuación, recurso, operaciones, archivos, incidencias y paquete
- ✔ el informe resumido es más breve que el técnico
- ✔ informe_tecnico.pdf: PDF válido (qpdf), A4, 14 páginas con «Página n de N» en todas
- ✔ informe_tecnico.pdf: contiene unidad, diligencias y los hashes de las evidencias
- ✔ informe_tecnico.pdf: escudo y logotipo incrustados (35 imágenes)
- ✔ informe_resumido.pdf: PDF válido (qpdf), A4, 3 páginas con «Página n de N» en todas
- ✔ informe_resumido.pdf: contiene unidad, diligencias y los hashes de las evidencias
- ✔ informe_resumido.pdf: escudo y logotipo incrustados (6 imágenes)

### Visor de informes · HTML autónomo, PDF e impresión

- ✔ el visor muestra el informe técnico con estilos y escudo dentro de un marco sin scripts
- ✔ el visor cambia al informe resumido con los mismos datos
- ✔ el visor descarga el informe como PDF y como HTML autónomo
- ✔ «Imprimir / Guardar como PDF» invoca la impresión del informe (no de la barra del visor)
- ✔ el visor no produce errores de JavaScript ni infracciones de CSP

### Verificar integridad · ZIP, carpeta, archivos modificados, ausentes y adicionales

- ✔ ZIP exportado: resultado global ÍNTEGRO con 25 coincidencias correctas
- ✔ ZIP exportado: la huella del ZIP coincide con su archivo .sha256
- ✔ el verificador lee el manifiesto (sesión, referencia, diligencias)
- ✔ genera un informe HTML de verificación con fecha, resultado global y detalle
- ✔ carpeta extraída: resultado ÍNTEGRO
- ✔ carpeta manipulada: resultado global CON INCIDENCIAS
- ✔ identifica el archivo modificado (un solo bit) como «Hash diferente» y muestra ambas huellas
- ✔ identifica el archivo borrado como «Archivo ausente»
- ✔ identifica el archivo añadido como «Archivo adicional no declarado»
- ✔ los archivos intactos siguen figurando como correctos
- ✔ ZIP recomprimido y manipulado: detecta las incidencias y que la huella del ZIP NO COINCIDE
- ✔ archivos sueltos con su manifiesto: los aportados coinciden y los no aportados constan como ausentes
- ✔ manifiesto ilegible: resultado «Manifiesto inválido» con el motivo
- ✔ ZIP truncado: resultado «Error de lectura» sin bloquear la página
- ✔ el verificador no produce errores de JavaScript y no altera la sesión de captura
- ✔ Configuración informa del almacenamiento local y del estado de los permisos

### Instagram · perfil con carga infinita, selección, descarga masiva y lote

- ✔ el perfil muestra las 6 primeras publicaciones con sus datos de API
- ✔ ficha de la cuenta: seguidores, publicaciones y biografía
- ✔ «Cargar más contenido» desplaza y detecta las 12 publicaciones
- ✔ las 12 publicaciones tienen datos de medios (no solo miniatura)
- ✔ descarga masiva: 18 archivos (3 carruseles×3, 3 reels, 6 imágenes) sin errores
- ✔ cada archivo queda vinculado a su publicación (carpeta y postKey)
- ✔ todas las publicaciones quedan marcadas como descargadas
- ✔ repetir la descarga no duplica nada (todo omitido)
- ✔ lote «abrir y capturar»: navega, captura cada publicación y vuelve al perfil
- ✔ el lote guarda una captura por cada publicación seleccionada
- ✔ Página completa del perfil (scroll de ventana) termina sin error
- ✔ el panel no produjo errores de JavaScript

### TikTok · vídeo (CDN que exige Referer) y perfil

- ✔ TikTok: detecta usuario, vídeo y descripción desde el JSON embebido
- ✔ TikTok: ofrece el vídeo y la portada
- ✔ TikTok: el vídeo se descarga (el CDN respondería 403 sin Referer)
- ✔ las peticiones de descarga al CDN de TikTok llevan Referer de tiktok.com
- ✔ TikTok perfil: 8 vídeos detectados desde item_list
- ✔ TikTok perfil: descarga los vídeos seleccionados

### Web genérica · imágenes (incl. perezosas), vídeo y página completa con cabecera fija

- ✔ web: detecta imágenes normales, perezosa (data-src), og:image y el vídeo <source>
- ✔ web: sin recursos falsos de la URL de la página
- ✔ web: descarga imágenes y vídeo validados
- ✔ web: captura de página completa con scroll de ventana (3316px ≈ 3316px)

### Página de 24 000 px · división automática en partes y unión sin costuras

- ✔ se divide en varias partes (2) de como máximo 14 000 px
- ✔ la suma de las partes coincide con la altura de la página (24040 ≈ 24040)
- ✔ cada parte sabe cuántas partes forman la captura
- ✔ los 200 bloques de color están en su sitio exacto, incluida la costura entre partes (200 comprobados)

### Cancelación, detección de una evidencia alterada y gestión de sesiones

- ✔ el botón Cancelar es visible y accesible durante una operación larga (en la v0.4.0 quedaba recortado)
- ✔ cancelar detiene la operación sin afectar a las evidencias ya guardadas
- ✔ la cancelación consta en el registro como incidencia
- ✔ «Comprobar hashes» detecta un archivo alterado en el almacén local
- ✔ la exportación avisa de la huella no coincidente y lo documenta en el manifiesto y en el informe
- ✔ los errores de descarga y avisos de la sesión figuran como incidencias del paquete
- ✔ una sesión puede agrupar capturas de varias plataformas
- ✔ al cambiar la referencia con evidencias de otro expediente se muestra un aviso para no mezclarlas
- ✔ se puede eliminar una evidencia antes de cerrar el paquete y la eliminación queda registrada
- ✔ «Nueva sesión» crea un identificador distinto y vacía evidencias y registro
- ✔ los datos del expediente no se arrastran a la sesión nueva
- ✔ el perfil institucional y el escudo se conservan para futuras sesiones
- ✔ la primera evidencia de la sesión nueva vuelve a numerarse desde EV-0001 y lleva su sesión
- ✔ si se desmarca «conservar el escudo», se elimina al iniciar otra sesión
- ✔ «Borrar todos los datos» elimina sesión, expediente, perfil institucional y preferencias
- ✔ el panel no produjo errores de JavaScript
