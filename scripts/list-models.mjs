// Lists models this API key can use (names only). Run: node --env-file=.env.local scripts/list-models.mjs
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const pager = await ai.models.list();
const names = [];
for await (const m of pager) names.push(`${m.name}  [${(m.supportedActions ?? []).join(",")}]`);
console.log(names.filter((n) => /gemini/.test(n)).join("\n"));
