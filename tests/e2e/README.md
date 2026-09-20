# Pruebas end-to-end

Cargan la extensión real en Chromium (Playwright) contra un servidor HTTPS local que simula Instagram, TikTok, sus CDN y una web genérica.

    npm i -D playwright sharp && npx playwright install chromium
    npm run test:e2e        # requiere openssl, ImageMagick (convert), ffmpeg y xvfb-run

Variables opcionales: `PLAYWRIGHT_MODULE`, `SHARP_MODULE` (rutas a los módulos si están instalados globalmente).
Las réplicas reproducen estructuras conocidas de las plataformas; no sustituyen una validación con cuentas reales.
