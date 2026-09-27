// Renders docs/guide/guide.html to docs/API-Pathfinder-Rehber.pdf using the local Microsoft Edge.
// Usage: node scripts/render-guide.mjs
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import path from "node:path";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
await page.goto(pathToFileURL(path.resolve("docs/guide/guide.html")).href, { waitUntil: "networkidle" });
await page.pdf({
  path: "docs/API-Pathfinder-Rehber.pdf",
  format: "A4",
  printBackground: true,
  margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
  displayHeaderFooter: true,
  headerTemplate: "<div></div>",
  footerTemplate:
    '<div style="font-size:8px;color:#8a929c;width:100%;text-align:center;font-family:Segoe UI,Arial">API Pathfinder — Proje Rehberi · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
});
await browser.close();
console.log("saved docs/API-Pathfinder-Rehber.pdf");
