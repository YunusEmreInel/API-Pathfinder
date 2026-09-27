// Sanity check: real embedding dimension and one Interactions API call.
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const e = await ai.models.embedContent({
  model: process.env.GEMINI_EMBEDDING_MODEL,
  contents: [{ role: "user", parts: [{ text: "task: search result | query: list products on sale" }] }],
  config: { outputDimensionality: Number(process.env.EMBEDDING_DIM) },
});
const v = e.embeddings[0].values;
console.log("embedding dims:", v.length, "norm:", Math.hypot(...v).toFixed(4));
const r = await ai.interactions.create({ model: process.env.GEMINI_MODEL, input: "Reply with exactly: pong", store: false });
console.log("interaction:", JSON.stringify(r.output_text), "steps:", r.steps.map((s) => s.type).join(","));
