const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import { startServer, HOST_RULES } from "./server.mjs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export async function launch(extPath, { helperPage = "recorder.html" } = {}) {
  const server = await startServer();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "rastro-e2e-"));
  const downloadsPath = path.join(userDataDir, "Downloads");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: undefined,
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    downloadsPath,
    viewport: null,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`,
      `--host-resolver-rules=${HOST_RULES}`, "--ignore-certificate-errors", "--no-sandbox",
      "--autoplay-policy=no-user-gesture-required", "--window-size=1200,900",
      `--enable-features=SidePanelUpdates`
    ]
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const close = async () => { await context.close(); server.close(); };
  return { context, sw, extId, close, userDataDir, downloadsPath };
}
