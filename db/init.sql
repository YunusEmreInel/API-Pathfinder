-- Runs once, when the Docker volume is first created.
CREATE EXTENSION IF NOT EXISTS vector;

-- One row per imported OpenAPI document.
CREATE TABLE api_documents (
  id              SERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  version         TEXT NOT NULL DEFAULT '',
  openapi_version TEXT NOT NULL,
  server_url      TEXT NOT NULL DEFAULT '',
  raw             JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per GET operation, plus the text we embedded and its vector.
CREATE TABLE operations (
  id                 SERIAL PRIMARY KEY,
  document_id        INT NOT NULL REFERENCES api_documents(id) ON DELETE CASCADE,
  operation_id       TEXT NOT NULL,
  path               TEXT NOT NULL,
  summary            TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL DEFAULT '',
  data               JSONB NOT NULL,          -- full ExtractedOperation (params, blockers, ...)
  embed_text         TEXT NOT NULL,           -- exactly what was sent to the embedding model
  embedding          vector(768),             -- NULL until embedded; dimension must match EMBEDDING_DIM
  embedding_model    TEXT,
  UNIQUE (document_id, operation_id)
);
CREATE INDEX operations_embedding_idx ON operations USING hnsw (embedding vector_cosine_ops);

-- Every user-confirmed "Try request".
CREATE TABLE try_runs (
  id            SERIAL PRIMARY KEY,
  operation_pk  INT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  parameters    JSONB NOT NULL,
  state         TEXT NOT NULL,                -- sent | needs_input | not_executable
  url           TEXT,
  http_status   INT,
  result_kind   TEXT,                         -- response | timeout | blocked | network_error
  response_body TEXT,                         -- already size-capped
  verdict       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every investigation: goal, model tool-call trace and final answer.
CREATE TABLE investigations (
  id          SERIAL PRIMARY KEY,
  document_id INT NOT NULL REFERENCES api_documents(id) ON DELETE CASCADE,
  goal        TEXT NOT NULL,
  mode        TEXT NOT NULL,                  -- rag | agent
  trace       JSONB NOT NULL,
  answer      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
