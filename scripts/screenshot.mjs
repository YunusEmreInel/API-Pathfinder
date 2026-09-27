// Drives the real UI and saves screenshots for the README. Needs `npm run dev`, the DB and a Gemini key.
// Usage: node scripts/screenshot.mjs        (uses the locally installed Microsoft Edge via playwright-core)
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: "light" });

await page.goto(BASE);
await page.getByRole("button", { name: "Demo dokümanı yükle" }).click();
await page.getByRole("button", { name: "İçe aktar" }).click();
await page.getByText("embedding üretildi").waitFor({ timeout: 60_000 });

// 1) Agent investigation -> user confirms -> real request
await page.getByPlaceholder("örn. Satışta olan ürünleri listele").fill("Satışta olan ürünleri listele");
await page.getByRole("button", { name: "İncele (Agent + araçlar)" }).click();
await page.getByRole("button", { name: "Bu işlemi incele ve dene →" }).waitFor({ timeout: 90_000 });
await page.getByRole("button", { name: "Bu işlemi incele ve dene →" }).click();
await page.getByRole("button", { name: "İsteği dene" }).click();
await page.getByText("Canlı istekte gözlenen").waitFor({ timeout: 30_000 });
await page.screenshot({ path: "docs/screenshot-agent.png", fullPage: true });
console.log("saved docs/screenshot-agent.png");

// 2) Raw pgvector results for a goal the document cannot serve
await page.getByPlaceholder("örn. Satışta olan ürünleri listele").fill("Müşteri yorumlarını listele");
await page.getByRole("button", { name: "Ham arama (yalnızca pgvector)" }).click();
await page.getByText("Ham pgvector sonuçları").waitFor({ timeout: 30_000 });
await page.locator("section.panel", { hasText: "Hedefini yaz" }).screenshot({ path: "docs/screenshot-raw-search.png" });
console.log("saved docs/screenshot-raw-search.png");

await browser.close();
