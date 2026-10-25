// Screenshot pass for the six pages. Waits for data-ready="true" on each page (max 30 s), saves .shots/<name>.png.
// Usage: node scripts/shots.mjs   (needs the backend on :8000 and the Next dev server on :3001 running)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const OUT = join(process.cwd(), "..", "..", ".shots");
const PAGES = [
  ["planning", "/"],
  ["demand", "/demand"],
  ["results", "/results"],
  ["map", "/map"],
  ["frontier", "/frontier"],
  ["stock", "/stock"],
  ["dispatch", "/dispatch"],
  ["assumptions", "/assumptions"],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

for (const [name, path] of PAGES) {
  const t0 = Date.now();
  let ready = true;
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
  } catch {
    ready = false;
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log(`${name}: ready=${ready} ${Date.now() - t0} ms`);
}
// Offline OpenStreetMap tiles fail by design, so they are counted apart. Anything else is printed in full.
const isTile = (e) => e.includes("tile.openstreetmap.org");
const other = errors.filter((e) => !isTile(e));
console.log(`errors: ${errors.length} (${errors.length - other.length} offline map tiles, ${other.length} other)`);
for (const e of other) console.log("  " + e);
await browser.close();

