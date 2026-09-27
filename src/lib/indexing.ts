// Creates embeddings for stored operations that don't have one yet.
import { config, documentEmbeddingInput, embed, MissingKeyError } from "./gemini";
import { getOperations, setEmbedding } from "./db";

export async function embedDocument(documentId: number): Promise<{ embedded: number; total: number; warning?: string }> {
  const ops = await getOperations(documentId);
  const todo = ops.filter((o) => !o.embedded);
  try {
    for (let i = 0; i < todo.length; i += 20) {
      const batch = todo.slice(i, i + 20);
      const vectors = await embed(batch.map((o) => documentEmbeddingInput(o.op.summary || o.op.operationId, o.embedText)), "document");
      await Promise.all(batch.map((o, j) => setEmbedding(o.pk, vectors[j], config.embeddingModel())));
    }
    return { embedded: todo.length, total: ops.length };
  } catch (e) {
    if (e instanceof MissingKeyError) return { embedded: 0, total: ops.length, warning: e.message };
    throw e;
  }
}
