# Guía operativa del investigador · RASTRO CAPTURE 0.5.0

## Antes de empezar

- Usa un perfil de navegador destinado a la investigación.
- Rellena una vez **INFORMES › Personalización institucional** (escudo, unidad, dependencia, identificador profesional).
- Tras instalar o actualizar la extensión, recarga (F5) las páginas ya abiertas.

## Flujo recomendado

1. Pulsa **Nueva sesión** si vas a trabajar en otro expediente. Escribe la **referencia** y el **n.º de diligencias** en la cabecera.
2. Abre el contenido y deja que cargue. **Analizar página actual**: comprueba plataforma, usuario, tipo e identificador.
3. Escribe una nota breve sobre lo que vas a documentar.
4. **Vista visible** para el contexto inmediato y **Publicación completa** para el bloque detectado.
5. **Guardar MHTML** y **Guardar datos (JSON)** cuando interese conservar la página y sus datos de origen.
6. Descarga imágenes y vídeos desde el listado multimedia. En perfiles: **Cargar**, selecciona y descarga, o **Abrir y capturar cada seleccionada**.
7. Si aparece HLS/DASH o falla la validación: **Abrir grabador de pestaña**, elige la pestaña objetivo (no la ventana de RASTRO) y termina con **Dejar de compartir**. Mantén abierta la ventana hasta ver la huella SHA-256.
8. En **EVIDENCIAS**, revisa la lista, añade notas y elimina lo que no proceda (queda registrado).
9. En **INFORMES**, escribe las observaciones generales, revisa ambos informes en el visor y pulsa **Exportar paquete ZIP con informes**.
10. Anota en las diligencias el **SHA-256 del ZIP** (se muestra al exportar y en el archivo `.sha256`). Conserva el ZIP sin modificar y trabaja sobre copias.

## Qué dato es de quién

| Etiqueta | Significado | Ejemplos |
|---|---|---|
| **A** | Obtenido automáticamente | URL, fechas del equipo, hashes, tamaños, texto y métricas entregados por la plataforma |
| **M** | Introducido por el investigador | Unidad, diligencias, notas, observaciones |
| **I** | Inferido por la herramienta | Plataforma (por el nombre de host), tipo de contenido (por el patrón de la URL), usuario cuando solo consta en la URL |

Una inferencia nunca se presenta como hecho verificado: revísala antes de incorporar el informe.

## Instagram

- Abre la URL individual `/p/…` o `/reel/…` además del perfil.
- Abre los comentarios necesarios antes de una captura de página completa.
- Historias y algunos vídeos usan recursos temporales: captura y exporta sin demora.

## TikTok

- Abre la URL individual `/@usuario/video/ID` y espera a que el vídeo empiece a reproducirse.
- Comprueba que descripción, usuario e ID coinciden con el contenido objetivo.

## Si algo falla

- **«Acceso denegado o enlace caducado» (403)**: recarga la página, vuelve a analizar y descarga de nuevo, o usa el grabador.
- **«El servidor exige autenticación» (401)**: la herramienta no elude controles de acceso; documenta con captura o grabación lo que tu sesión muestra.
- **Sin datos de la plataforma**: recarga con la extensión instalada y vuelve a analizar.
- Un error en una captura no afecta a las evidencias ya guardadas. Queda anotado como incidencia y aparecerá en el informe.

## Integridad

- **Comprobar hashes** (EVIDENCIAS) recalcula el SHA-256 de los archivos locales.
- **Verificar integridad** comprueba un paquete ya exportado, ahora o meses después.
- El informe presenta la evidencia; no la sustituye. Las vistas previas son derivadas: el archivo de evidencia es el de la carpeta `evidencias/`.
- Antes de incorporar un informe a diligencias, revísalo: es documentación técnica generada automáticamente a partir de tus capturas y de los datos que has introducido.
