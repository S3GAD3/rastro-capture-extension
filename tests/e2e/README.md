# Pruebas end-to-end

Cargan la extensión real en Chromium (Playwright) contra un servidor HTTPS local que simula Instagram, TikTok, sus CDN y una web genérica. No se conectan a las plataformas reales.

    npm i -D playwright sharp && npx playwright install chromium
    bash tests/e2e/setup.sh     # certificado y ficheros de prueba
    npm run test:e2e

Requiere `openssl`, ImageMagick (`convert`), `ffmpeg`, `xvfb-run`, `unzip`, `zip`, `sha256sum`, `qpdf` y poppler (`pdfinfo`, `pdftotext`, `pdfimages`).

Variables opcionales: `PLAYWRIGHT_MODULE`, `SHARP_MODULE` (rutas a los módulos) y `RASTRO_E2E_ARTIFACTS` (carpeta donde se dejan capturas de pantalla e informes generados). Si el equipo usa un proxy, ejecútalas sin las variables `HTTP(S)_PROXY`.

Las réplicas reproducen estructuras conocidas de las plataformas; no sustituyen una validación con cuentas reales.
