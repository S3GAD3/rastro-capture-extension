# Seguridad

RASTRO CAPTURE no debe utilizarse para eludir autenticación, cifrado, DRM ni controles de acceso. Actúa únicamente sobre la pestaña que el usuario activa de forma expresa.

## Medidas aplicadas

- CSP explícita en las páginas de la extensión: solo scripts propios, sin `eval`, sin objetos.
- El service worker solo atiende mensajes de páginas de la propia extensión.
- Sin dependencias, scripts ni fuentes de terceros.
- Todo contenido de terceros se escapa antes de mostrarse. Los informes no contienen scripts, llevan CSP `default-src 'none'` y solo admiten imágenes `data:` PNG o JPEG.
- El escudo institucional se decodifica como imagen y se vuelve a codificar a PNG: un SVG nunca se guarda con contenido activo.
- El lector ZIP del verificador rechaza rutas absolutas o con `..`, duplicados y archivos cifrados.
- Los CSV neutralizan la inyección de fórmulas.

## Comunicar una vulnerabilidad

No incluyas datos reales de investigaciones, credenciales, cookies ni contenido personal. Describe el problema con una página de prueba o un caso reproducible.

Los archivos exportados pueden contener datos personales y material sensible: almacénalos y compártelos conforme a los procedimientos de la unidad investigadora.
