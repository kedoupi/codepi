import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchBrowser } from "../../../apps/health/scripts/browser-cdp.mjs";
const [outDir, ...pairs] = process.argv.slice(2);
const { page, close } = await launchBrowser(join(outDir, ".cdp"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  for (const pair of pairs) {
    const [name, w, url] = pair.split("|");
    const mobile = Number(w) < 600;
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: Number(w), height: 300, deviceScaleFactor: 1, mobile });
    await page.cdp("Page.navigate", { url });
    await sleep(3000);
    const m = await page.cdp("Page.getLayoutMetrics");
    const h = Math.min(Math.ceil(m.cssContentSize?.height || 300), 9000);
    const shot = await page.cdp("Page.captureScreenshot", { format: "jpeg", quality: 65, captureBeyondViewport: true, clip: { x: 0, y: 0, width: Number(w), height: h, scale: 1 } });
    await writeFile(join(outDir, `${name}.jpg`), Buffer.from(shot.data, "base64"));
    console.log("ok", name, h);
  }
} finally { await close(); }
