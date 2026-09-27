// PostgreSQL access. Every query uses $1, $2… placeholders — values are never concatenated into SQL.
import { Pool } from "pg";
import type { ExtractedOperation, ParsedDocument } from "./openapi";
import type { TryOutcome } from "./try-request";

const globalForPg = globalThis as unknown as { pgPool?: Pool };

export function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env.example).");
  // Reuse one pool across Next.js hot reloads in development.
  globalForPg.pgPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return globalForPg.pgPool;
}

/** pgvector accepts vectors as the text literal '[0.1,0.2,…]'. */
export const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;

/** The text we embed for an operation: only documented facts, labelled, no response data. */
export function embedTextFor(op: ExtractedOperation): string {
  const params = op.params
    .map((p) => `${p.name} (${p.in}, ${p.type}${p.required ? ", required" : ""}${p.enum ? `, one of ${p.enum.join("/")}` : ""})${p.description ? `: ${p.description}` : ""}`)
    .join("; ");
  return [
    `GET ${op.path}`,
    op.summary && `Summary: ${op.summary}`,
    op.description && `Description: ${op.description}`,
    op.tags.length > 0 && `Tags: ${op.tags.join(", ")}`,
    params && `Parameters: ${params}`,
    `Returns: ${op.responseSummary}`,
  ].filter(Boolean).join("\n");
}

export interface StoredOperation {
  pk: number;
  documentId: number;
  serverUrl: string;
  op: ExtractedOperation;
  embedText: string;
  embedded: boolean;
}

export async function insertDocument(parsed: ParsedDocument, raw: unknown): Promise<{ documentId: number; operations: StoredOperation[] }> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const doc = await client.query<{ id: number }>(
      `INSERT INTO api_documents (title, version, openapi_version, server_url, raw) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [parsed.title, parsed.version, parsed.openapiVersion, parsed.serverUrl, JSON.stringify(raw)],
    );
    const documentId = doc.rows[0].id;
    const operations: StoredOperation[] = [];
    for (const op of parsed.operations) {
      const embedText = embedTextFor(op);
      const r = await client.query<{ id: number }>(
        `INSERT INTO operations (document_id, operation_id, path, summary, description, data, embed_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [documentId, op.operationId, op.path, op.summary, op.description, JSON.stringify(op), embedText],
      );
      operations.push({ pk: r.rows[0].id, documentId, serverUrl: parsed.serverUrl, op, embedText, embedded: false });
    }
    await client.query("COMMIT");
    return { documentId, operations };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function setEmbedding(pk: number, vector: number[], model: string) {
  await pool().query(`UPDATE operations SET embedding = $1::vector, embedding_model = $2 WHERE id = $3`, [toVectorLiteral(vector), model, pk]);
}

export async function listDocuments() {
  const r = await pool().query<{ id: number; title: string; version: string; server_url: string; created_at: string; operation_count: number; embedded_count: number }>(
    `SELECT d.id, d.title, d.version, d.server_url, d.created_at,
            count(o.id)::int AS operation_count, count(o.embedding)::int AS embedded_count
       FROM api_documents d LEFT JOIN operations o ON o.document_id = d.id
      GROUP BY d.id ORDER BY d.id DESC LIMIT 20`,
  );
  return r.rows;
}

type OpRow = { id: number; document_id: number; server_url: string; data: ExtractedOperation; embed_text: string; embedded: boolean };
const OP_COLUMNS = `o.id, o.document_id, d.server_url, o.data, o.embed_text, (o.embedding IS NOT NULL) AS embedded`;
const toStored = (r: OpRow): StoredOperation => ({ pk: r.id, documentId: r.document_id, serverUrl: r.server_url, op: r.data, embedText: r.embed_text, embedded: r.embedded });

export async function getOperations(documentId: number): Promise<StoredOperation[]> {
  const r = await pool().query<OpRow>(
    `SELECT ${OP_COLUMNS} FROM operations o JOIN api_documents d ON d.id = o.document_id WHERE o.document_id = $1 ORDER BY o.id`,
    [documentId],
  );
  return r.rows.map(toStored);
}

export async function getOperation(documentId: number, operationId: string): Promise<StoredOperation | null> {
  const r = await pool().query<OpRow>(
    `SELECT ${OP_COLUMNS} FROM operations o JOIN api_documents d ON d.id = o.document_id WHERE o.document_id = $1 AND o.operation_id = $2`,
    [documentId, operationId],
  );
  return r.rows[0] ? toStored(r.rows[0]) : null;
}

export interface SearchHit extends StoredOperation {
  /** Cosine distance from pgvector's <=> operator (0 = same direction, 2 = opposite). */
  distance: number;
  /** 1 - distance, for display. */
  similarity: number;
}

/** Nearest operations by cosine distance. This is similarity, not correctness. */
export async function searchByVector(documentId: number, vector: number[], limit = 5): Promise<SearchHit[]> {
  const r = await pool().query<OpRow & { distance: number }>(
    `SELECT ${OP_COLUMNS}, (o.embedding <=> $2::vector) AS distance
       FROM operations o JOIN api_documents d ON d.id = o.document_id
      WHERE o.document_id = $1 AND o.embedding IS NOT NULL
      ORDER BY o.embedding <=> $2::vector
      LIMIT $3`,
    [documentId, toVectorLiteral(vector), limit],
  );
  return r.rows.map((row) => ({ ...toStored(row), distance: Number(row.distance), similarity: 1 - Number(row.distance) }));
}

export async function saveTryRun(operationPk: number, parameters: unknown, outcome: TryOutcome) {
  const sent = outcome.state === "sent" ? outcome : null;
  const res = sent?.result.kind === "response" ? sent.result : null;
  const r = await pool().query<{ id: number }>(
    `INSERT INTO try_runs (operation_pk, parameters, state, url, http_status, result_kind, response_body, verdict)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [operationPk, JSON.stringify(parameters), outcome.state, sent?.url ?? null, res?.status ?? null, sent?.result.kind ?? null, res?.body ?? null, sent?.verdict ?? null],
  );
  return r.rows[0].id;
}

export async function saveInvestigation(documentId: number, goal: string, mode: string, trace: unknown, answer: string | null) {
  const r = await pool().query<{ id: number }>(
    `INSERT INTO investigations (document_id, goal, mode, trace, answer) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [documentId, goal, mode, JSON.stringify(trace), answer],
  );
  return r.rows[0].id;
}
