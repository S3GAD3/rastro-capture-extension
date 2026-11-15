# RASTRO CAPTURE

**Kit RASTRO — Herramientas de Investigación de Fuentes Abiertas** · Creado por **S3GAD3**

Extensión para navegadores Chromium que captura, contextualiza y preserva contenido web y de redes sociales durante investigaciones OSINT/SOCMINT. Calcula el SHA-256 de cada archivo, registra las operaciones, genera informes institucionales y exporta un paquete de evidencias autocontenido y verificable. Todo el procesamiento es local.

Versión 0.5.0. Optimizada para publicaciones, reels, vídeos y perfiles de Instagram y TikTok; funciona también en webs genéricas.

## Finalidad técnica de las funciones

| Función | Para qué sirve en una investigación |
|---|---|
| **Analizar página** | Identifica URL, plataforma, cuenta, publicación, fecha, texto, métricas y medios accesibles, a partir de los datos que la plataforma entrega al navegador y, en su defecto, del DOM. |
| **Capturas** (vista visible, publicación, página completa) | Documenta lo que se mostraba en pantalla. Las capturas largas se componen por tramos y se dividen en partes. |
| **MHTML / datos JSON** | Conserva una copia navegable de la página y los datos de origen recibidos por ella. |
| **Descarga de imágenes y vídeos** | Obtiene los archivos tal como los sirve el origen (sin transformar), validados por firma binaria y estructura. |
| **Perfiles** | Carga más publicaciones, permite seleccionarlas, descargar sus medios en bloque o abrir y capturar cada una. |
| **Grabador de pestaña** | Documenta vídeos no descargables (HLS/DASH, fuentes internas) o una navegación. |
| **Sesión** | Agrupa las evidencias de un expediente bajo un identificador único y evita mezclar investigaciones. |
| **SHA-256 y manifiesto** | Permiten comprobar después que ningún archivo ha cambiado. |
| **Informes** | Informe técnico completo e informe resumido para diligencias, con el escudo de la unidad, en HTML autónomo y PDF. |
| **Verificar integridad** | Comprueba un paquete ya exportado: coincidencias, archivos modificados, ausentes o añadidos. |

## Instalación (Chrome, Edge, Brave, Opera · versión 116 o posterior)

1. Descomprime el ZIP de la extensión.
2. Abre `chrome://extensions` (o `edge://extensions`, `brave://extensions`, `opera://extensions`).
3. Activa **Modo de desarrollador**.
4. Pulsa **Cargar descomprimida** y selecciona la carpeta `rastro-capture-v0.5.0` (la que contiene `manifest.json`).
5. Fija el icono de RASTRO CAPTURE en la barra. Al pulsarlo se abre el panel lateral.

Si actualizas desde la 0.4.0, carga la carpeta nueva en lugar de la anterior: las evidencias locales se conservan y los datos de unidad e investigador pasan al perfil institucional.

> Compatibilidad comprobada: las pruebas automáticas se ejecutan en Chromium 153 (Chrome for Testing). Edge, Brave y Opera comparten el mismo motor y las mismas API, pero no se han probado uno a uno; Firefox y Safari no son compatibles (la extensión usa el panel lateral y API específicas de Chromium).

## Manual breve

El panel tiene una cabecera fija con la **sesión activa** (identificador, número de evidencias, referencia y diligencias) y cuatro secciones.

**CAPTURA**
1. Abre la publicación, perfil o página. Tras instalar o actualizar, recarga la página (F5).
2. **Analizar página actual** y comprueba plataforma, usuario, identificador y medios. Las etiquetas `A` e `I` indican si el dato es automático o inferido.
3. Escribe, si procede, una nota para la próxima captura.
4. Captura: **Publicación completa**, **Vista visible**, **Página completa**, **MHTML**, **Datos (JSON)**.
5. Descarga los medios desde *Multimedia de esta página* o, en un perfil, desde *Publicaciones detectadas*.
6. Si un vídeo figura como no descargable, usa **Abrir grabador de pestaña**.

**EVIDENCIAS** — Lista con miniatura, tamaño, fecha, clase (original, captura generada o derivado) y SHA-256 completo. Permite copiar el hash, añadir una nota, eliminar una evidencia (queda registrado), **Comprobar hashes** de los archivos locales y abrir **Verificar integridad**.

**INFORMES** — Personalización institucional, datos del expediente, visor de informes y exportación del paquete.

**CONFIG.** — Espacio usado, qué datos permanecen en el navegador, borrado de datos y permisos.

## Personalización institucional

En **INFORMES › Personalización institucional**:

- **Escudo o logotipo de la unidad**: PNG, JPG o SVG (máx. 5 MB). Puedes verlo, cambiarlo o eliminarlo. Al cargarlo se rasteriza a PNG: un SVG nunca se guarda ni se incrusta con contenido activo.
- **Unidad investigadora**, **dependencia o grupo**, **identificador profesional** y **lugar de actuación** (opcional).
- **Conservar el escudo para futuras sesiones**: si lo desmarcas, se borra al iniciar otra sesión.

Estos datos son **reutilizables**. Los **datos del expediente** (referencia, n.º de diligencias, denominación y observaciones generales) pertenecen solo a la sesión en curso y se vacían con **Nueva sesión**, para no arrastrar información de una investigación a otra. Todo se guarda únicamente en el navegador.

## Generación de informes

- **Informe técnico** e **Informe resumido** abren el visor. Desde él puedes cambiar de modalidad, **Imprimir / Guardar como PDF** (diálogo del navegador), **Descargar HTML** (autónomo, sin recursos externos) o **Descargar PDF** (generado localmente).
- **Exportar paquete ZIP con informes** incluye ambos informes en HTML y, si está marcada la opción, en PDF.

| | Informe técnico completo | Informe resumido para diligencias |
|---|---|---|
| Contenido | 1 Actuación · 2 Recurso · 3 Descripción técnica · 4 Relación de evidencias · 5 Integridad · 6 Cronología · 7 Observaciones · 8 Limitaciones · 9 Anexo con vistas previas | Actuación · recurso · operaciones realizadas · archivos y hashes · incidencias · observaciones · referencia al paquete |
| Uso | Documento de respaldo técnico | Texto breve para incorporar a las diligencias |

En ambos, el escudo de la unidad va en el encabezado y el logotipo de RASTRO CAPTURE en el pie, incrustados en el propio documento. Cada dato lleva su procedencia: **A** automático, **M** introducido manualmente, **I** inferido (con su fundamento). Los informes describen hechos técnicos; no afirman autoría ni autenticidad.

Ejemplos con datos ficticios en [`docs/ejemplos/`](docs/ejemplos/).

## Paquete de evidencias

```
RASTRO_CAPTURE_<referencia>_<fecha>Z/
├── evidencias/            archivos sin modificar (capturas/, medios/, paginas-mhtml/, grabaciones/, datos-origen/)
├── informes/              informe_tecnico.html · informe_resumido.html · (.pdf)
├── registros/             actividad.json · actividad.csv · evidencias.csv · publicaciones.csv
├── metadatos/             manifest.json · SHA256SUMS.txt
└── README_EVIDENCIAS.txt
```

Junto al ZIP se descarga `<paquete>.zip.sha256` con el SHA-256 del ZIP. Va fuera del ZIP porque incluirlo dentro alteraría los bytes sobre los que se calcula. Consigna ese valor en las diligencias.

`manifest.json` recoge, por evidencia: identificador, ruta, tamaño, MIME, SHA-256, fecha, URL de origen, método de captura, advertencias y clase (**original** = bytes servidos por el origen; **captura** = generado al capturar; **derivado** = elaborado a partir de otros datos).

## Verificar evidencias

**Con la extensión**: EVIDENCIAS › **Verificar integridad**. Elige el ZIP (y su `.sha256`), la carpeta extraída o archivos sueltos con su `manifest.json`. Resultados posibles: coincidencia correcta, hash diferente, archivo ausente, archivo adicional no declarado, error de lectura y manifiesto inválido. Puedes guardar un informe HTML de la verificación.

**Con el sistema operativo**, en la carpeta extraída:

```
sha256sum -c metadatos/SHA256SUMS.txt        # Linux
shasum -a 256 -c metadatos/SHA256SUMS.txt    # macOS
Get-FileHash -Algorithm SHA256 <archivo>     # Windows PowerShell
sha256sum -c <paquete>.zip.sha256            # huella del ZIP completo
```

La coincidencia de hashes acredita la integridad respecto del manifiesto. No acredita por sí misma quién creó el contenido ni cuándo se publicó.

## Limitaciones conocidas

- Instagram y TikTok cambian su estructura interna con frecuencia. La extracción está verificada con réplicas locales (`npm run test:e2e`), no con las plataformas reales: valida con una cuenta real tras cambios importantes.
- Solo se captura lo que el navegador del investigador puede mostrar. No se eluden autenticación, controles de acceso, cifrado ni DRM.
- Los enlaces de medios caducan; descarga y exporta sin demora.
- HLS y DASH se detectan pero no se unen: usa el grabador. El WebM resultante no tiene índice de búsqueda.
- Las fechas proceden del reloj del equipo. No hay sellado de tiempo cualificado.
- El PDF generado localmente usa fuentes estándar: emojis y alfabetos no latinos se sustituyen por «?» (se advierte en el propio PDF). El HTML conserva el texto íntegro.
- El grabador de pestaña requiere interacción con el selector del navegador y no está cubierto por las pruebas automáticas.
- ZIP clásico: máximo 3,75 GB por paquete. Medios de más de 500 MB no se descargan.

## Desarrollo y pruebas

```
npm test            # 49 pruebas unitarias (Node 20+), sin dependencias
npm run check       # comprobación de sintaxis
npm run test:e2e    # 150 comprobaciones en Chromium real (ver tests/e2e/README.md)
npm run examples    # regenera docs/ejemplos
```

Sin dependencias de terceros en tiempo de ejecución. Consulta [CHANGELOG.md](CHANGELOG.md), [docs/GUIA-DEL-INVESTIGADOR.md](docs/GUIA-DEL-INVESTIGADOR.md), [docs/PRUEBAS.md](docs/PRUEBAS.md), [PRIVACY.md](PRIVACY.md) y [SECURITY.md](SECURITY.md).

## Licencia

MIT. Consulta [LICENSE](LICENSE) y [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
