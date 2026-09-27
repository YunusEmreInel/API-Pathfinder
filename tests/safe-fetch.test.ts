import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { checkAllowed, safeGet } from "@/lib/safe-fetch";

// A real local HTTP server with misbehaving endpoints.
let server: http.Server;
let origin = "";
let hits = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits++;
    if (req.url === "/slow") { setTimeout(() => res.end("{}"), 2000); return; }
    if (req.url === "/redirect") { res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" }); res.end(); return; }
    if (req.url === "/big") { res.setHeader("content-type", "application/json"); res.end("x".repeat(10_000)); return; }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const opts = () => ({ allowedOrigins: [origin], timeoutMs: 300, maxBytes: 1000 });

describe("checkAllowed", () => {
  it("allows only exact listed origins", () => {
    expect(checkAllowed("http://localhost:3000/demo-api/x", ["http://localhost:3000"]).ok).toBe(true);
    expect(checkAllowed("http://localhost:3001/x", ["http://localhost:3000"]).ok).toBe(false);
    expect(checkAllowed("http://127.0.0.1:3000/x", ["http://localhost:3000"]).ok).toBe(false);
    expect(checkAllowed("http://169.254.169.254/latest", ["http://localhost:3000"]).ok).toBe(false);
    expect(checkAllowed("file:///etc/passwd", ["http://localhost:3000"]).ok).toBe(false);
    expect(checkAllowed("http://user:pw@localhost:3000/", ["http://localhost:3000"]).ok).toBe(false);
  });
});

describe("safeGet", () => {
  it("does not contact hosts outside the allowlist", async () => {
    const before = hits;
    const r = await safeGet(`${origin}/ok`, { ...opts(), allowedOrigins: ["http://localhost:3000"] });
    expect(r.kind).toBe("blocked");
    expect(hits).toBe(before);
  });

  it("returns status and parsed JSON", async () => {
    const r = await safeGet(`${origin}/ok`, opts());
    expect(r).toMatchObject({ kind: "response", status: 200, ok: true, json: { ok: true }, truncated: false });
  });

  it("times out slow services", async () => {
    const r = await safeGet(`${origin}/slow`, opts());
    expect(r.kind).toBe("timeout");
  });

  it("does not follow redirects", async () => {
    const r = await safeGet(`${origin}/redirect`, opts());
    expect(r).toMatchObject({ kind: "response", status: 302, redirectLocation: "http://169.254.169.254/latest/meta-data" });
  });

  it("caps the response size", async () => {
    const r = await safeGet(`${origin}/big`, opts());
    expect(r.kind === "response" && r.truncated).toBe(true);
    expect(r.kind === "response" && r.body.length).toBe(1000);
  });
});
