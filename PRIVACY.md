# Privacidad de RASTRO CAPTURE

RASTRO CAPTURE procesa localmente la pestaña que el usuario decide analizar. No incorpora telemetría, publicidad, cuentas de usuario ni servidor propio, y no envía información a terceros.

## Qué se guarda en el navegador

| Dato | Dónde | Hasta cuándo |
|---|---|---|
| Evidencias, registro de actividad y catálogo de publicaciones | IndexedDB de la extensión | Hasta **Nueva sesión**, el borrado desde Configuración o la desinstalación |
| Datos del expediente (referencia, diligencias, denominación, observaciones) | `chrome.storage.local` | Hasta **Nueva sesión** |
| Perfil institucional y escudo | `chrome.storage.local` | Hasta que se borren desde Configuración |
| Preferencias | `chrome.storage.local` | Hasta **Borrar todos los datos** |

Las copias en Descargas y los ZIP exportados son archivos del usuario: la extensión no los borra.

## Permisos

Acceso fijo a Instagram y TikTok (y sus CDN) para que el análisis funcione al navegar por ellos. Para otras webs el acceso se pide cuando hace falta; el permiso «acceder a todos los sitios» es opcional y puede retirarse desde Configuración. Se usan para leer el contenido visible y sus metadatos, localizar medios, capturar, grabar cuando el usuario lo inicia y guardar los archivos solicitados.

Los medios descargados se piden al servidor que los aloja, que puede registrar la petición. Las descargas de los CDN de Instagram y TikTok llevan el `Referer` de la plataforma, como las de la propia página.

## Lo que no hace

- No lee ni exporta contraseñas, cookies, cabeceras de autenticación ni tokens de sesión.
- No elude autenticación, controles de acceso, cifrado ni DRM.
- El recolector de Instagram y TikTok es pasivo: observa las respuestas JSON que la página ya recibe; no hace peticiones propias ni modifica las respuestas.

Los datos de origen guardados (JSON de la plataforma, MHTML) son contenido de la página y pueden incluir datos personales de terceros. Trátalos conforme a los procedimientos de tu unidad.
