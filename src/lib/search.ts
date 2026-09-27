// Semantic search: embed the goal, ask pgvector for the nearest stored operations.
import { embed, queryEmbeddingInput } from "./gemini";
import { searchByVector, type SearchHit } from "./db";

export async function searchOperations(documentId: number, query: string, limit = 5): Promise<SearchHit[]> {
  const [vector] = await embed([queryEmbeddingInput(query)], "query");
  return searchByVector(documentId, vector, limit);
}

/** What we tell the model / UI about a hit. Only documented facts. */
export function hitSummary(h: SearchHit) {
  return {
    operation_id: h.op.operationId,
    method: "GET",
    path: h.op.path,
    summary: h.op.summary,
    similarity: Number(h.similarity.toFixed(3)),
    executable: h.op.blockers.length === 0,
  };
}
