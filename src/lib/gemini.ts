// Gemini client + embeddings. Uses the official @google/genai SDK.
import { GoogleGenAI } from "@google/genai";

export class MissingKeyError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not set. Add it to .env.local (see .env.example) and restart `npm run dev`.");
  }
}

export const config = {
  model: () => process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  embeddingModel: () => process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2",
  embeddingDim: () => Number(process.env.EMBEDDING_DIM || 768),
};

let client: GoogleGenAI | null = null;
export function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MissingKeyError();
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

// gemini-embedding-2 takes the retrieval task as a text prefix (gemini-embedding-001 used taskType instead).
const isEmbedding2 = () => config.embeddingModel().startsWith("gemini-embedding-2");

export function documentEmbeddingInput(title: string, text: string) {
  return isEmbedding2() ? `title: ${title} | text: ${text}` : text;
}
export function queryEmbeddingInput(query: string) {
  return isEmbedding2() ? `task: search result | query: ${query}` : query;
}

/** Embeds each string separately. Throws if the model returns a different dimension than the DB column. */
export async function embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
  const dim = config.embeddingDim();
  const res = await gemini().models.embedContent({
    model: config.embeddingModel(),
    // One Content per text => one embedding per text.
    contents: texts.map((t) => ({ role: "user", parts: [{ text: t }] })),
    config: {
      outputDimensionality: dim,
      ...(isEmbedding2() ? {} : { taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT" }),
    },
  });
  const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
  if (vectors.length !== texts.length) throw new Error(`Expected ${texts.length} embeddings, got ${vectors.length}.`);
  for (const v of vectors) {
    if (v.length !== dim) throw new Error(`Embedding has ${v.length} dimensions but the database column is vector(${dim}).`);
  }
  // Normalize so cosine distance is well-behaved even for models that don't normalize truncated vectors.
  return vectors.map((v) => {
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  });
}
