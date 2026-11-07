import { writeFile } from "node:fs/promises";
import { launchBrowser } from "../../../apps/health/scripts/browser-cdp.mjs";
const dir = process.argv[2];
const { page, close } = await launchBrowser(dir + "/.cdp");
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: 700, height: 900, deviceScaleFactor: 2, mobile: false });
  await page.cdp("Page.navigate", { url: `file://${dir}/charts.html?t=${Date.now()}` });
  await sleep(5000);
  const r = await page.cdp("Runtime.evaluate", { expression: "JSON.stringify({done: !!window.__done, err: window.__err || null, boxes:[...document.querySelectorAll('.c')].map(d=>{const b=d.getBoundingClientRect();return {id:d.id,x:b.x,y:b.y+scrollY,w:b.width,h:b.height}})})", returnByValue: true });
  const info = JSON.parse(r.result.value);
  console.log("done", info.done, info.boxes.length);
  for (const b of info.boxes) {
    const shot = await page.cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: 1 } });
    await writeFile(`${dir}/out/${b.id}.png`, Buffer.from(shot.data, "base64"));
    console.log("ok", b.id, b.w, b.h);
  }
} finally { await close(); }
