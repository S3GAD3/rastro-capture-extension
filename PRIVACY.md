# Privacidad de RASTRO CAPTURE

RASTRO CAPTURE procesa localmente la pestaña que el usuario decide analizar. No incorpora telemetría, publicidad, cuentas de usuario ni un servidor propio.

La extensión dispone de acceso de lectura a páginas de Instagram y TikTok para que el análisis continúe funcionando al navegar dentro de esas plataformas. Para otras webs, el acceso es temporal y comienza tras una acción expresa del usuario. Estos permisos se utilizan para:

- leer el contenido visible y sus metadatos;
- localizar imágenes y vídeos expuestos por la página;
- generar capturas;
- grabar la pestaña cuando el usuario inicia esa función;
- guardar archivos solicitados;
- conservar localmente las evidencias hasta su exportación o eliminación.

Los enlaces multimedia descargados siguen siendo solicitados al servidor que aloja el contenido. Ese servidor puede registrar la petición conforme a sus propias políticas.

La extensión no lee ni exporta contraseñas, cookies o credenciales. Tampoco intenta evitar controles de acceso, cifrado o DRM.

El usuario puede eliminar la investigación local mediante el botón **Nueva** o desinstalando la extensión.

## Recolector de respuestas (v0.4.0)

En Instagram y TikTok la extensión inyecta un script pasivo que observa las respuestas JSON que la propia página ya recibe (publicaciones, cuentas, listados). No realiza peticiones propias, no lee cookies ni cabeceras de autenticación y no modifica las respuestas. Los datos se guardan solo en el navegador del investigador hasta su exportación o eliminación.

Para descargar vídeos de los CDN de las plataformas, las peticiones iniciadas por la extensión llevan el `Referer` de la plataforma, igual que las que haría la propia página. El permiso «acceder a todos los sitios» es opcional y se solicita solo cuando es necesario.
