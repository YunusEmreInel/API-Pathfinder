// Checks that a model answers and can emit a function call. Usage: node --env-file=.env.local scripts/probe-model.mjs <model>
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const model = process.argv[2];
const r = await ai.interactions.create({
  model, store: false, input: "Find the endpoint that lists products.",
  tools: [{ type: "function", name: "search_endpoints", description: "Search API operations", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }],
});
console.log(model, "->", r.steps.map((s) => s.type === "function_call" ? `function_call ${s.name}(${JSON.stringify(s.arguments)})` : s.type).join(", "));
