# Guía operativa del investigador

## Preparación

Utiliza un perfil de navegador destinado a la investigación. Abre el contenido y deja que se carguen la publicación, imágenes, comentarios o vídeo que quieras conservar.

## Novedades de la 0.4.0 en el flujo
- Recarga la página (F5) tras instalar o actualizar; así se obtienen los originales y todos los metadatos.
- En perfiles usa **Cargar** antes de seleccionar; después descarga los medios de las publicaciones elegidas o captura cada una en lote.
- Los ficheros del paquete llevan código `EV-0001…` y el informe los relaciona con su publicación, hash y hora UTC/local.

## Flujo recomendado

1. Escribe la referencia del expediente.
2. Pulsa **Analizar página actual** y comprueba plataforma, usuario, tipo e identificador.
3. Añade una nota breve que explique qué se pretende documentar.
4. Haz una **Captura visible** para conservar el contexto inmediato.
5. Haz una **Captura de publicación completa** para conservar el bloque detectado.
6. Guarda MHTML cuando interese una copia adicional de la página.
7. Descarga imágenes o vídeos directos desde el listado multimedia.
8. Si aparece HLS/DASH o falla la validación, pulsa **Abrir grabador de pestaña**. En el grabador elige **Pestaña** y después la pestaña exacta de Instagram o TikTok. No selecciones la ventana de RASTRO.
9. Recorre el perfil o reproduce el contenido. Termina con **Dejar de compartir** en el navegador o desde la ventana del grabador.
10. Exporta el paquete ZIP.
11. Conserva sin modificar el ZIP y trabaja sobre copias posteriores.

Cada captura PNG se descarga inmediatamente dentro de la carpeta `RASTRO-CAPTURE` de las descargas configuradas en el navegador. También se incorpora al expediente local.

La grabación se inicia mediante el selector nativo de pestañas de Chromium y se guarda como WebM en la misma carpeta. También se incorpora automáticamente al expediente local y al paquete ZIP. Mantén abierta la ventana del grabador hasta que aparezcan la vista previa, la ruta y la huella SHA-256.

La descarga multimedia solo se considera correcta cuando el contenido recibido es realmente una imagen compatible o un vídeo MP4/WebM completo. Si el servidor devuelve una página, datos JSON, una lista HLS/DASH o un fragmento, RASTRO no crea un falso `.mp4`: muestra el error y recomienda la grabación.

## Instagram

- Es preferible abrir la URL individual `/p/…` o `/reel/…`, no limitarse al perfil.
- En carruseles, avanza por las imágenes antes de analizar si quieres que el navegador cargue todos los recursos.
- Abre los comentarios necesarios antes de realizar una captura de página completa.
- Las historias y algunos vídeos pueden utilizar recursos temporales; conviene capturarlos y exportarlos sin demora.

## TikTok

- Abre la URL individual `/@usuario/video/ID`.
- Espera a que el vídeo empiece a reproducirse antes de analizar para facilitar la detección del recurso.
- Si se detecta HLS/DASH o una dirección no descargable, utiliza la grabación de pestaña.
- Comprueba que descripción, usuario e ID coinciden con el contenido objetivo antes de exportar.

## Integridad

Las capturas incluidas en el ZIP tienen una huella SHA-256. `SHA256SUMS.txt` permite comprobar posteriormente que los archivos no han cambiado. El informe HTML presenta la evidencia y su contexto, pero no debe utilizarse para reemplazar el archivo original.
