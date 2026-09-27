import { describe, expect, it } from "vitest";
import demo from "../demo/store-openapi.json";
import { parseOpenApi } from "@/lib/openapi";
import { buildRequestUrl } from "@/lib/request-builder";

const parsed = parseOpenApi(demo);
const op = (id: string) => parsed.operations.find((o) => o.operationId === id)!;
const SERVER = parsed.serverUrl;

describe("buildRequestUrl", () => {
  it("adds query parameters under the server base path", () => {
    expect(buildRequestUrl(op("listProducts"), SERVER, { status: "on_sale" })).toEqual({
      ok: true, url: "http://localhost:3000/demo-api/products?status=on_sale", used: { status: "on_sale" },
    });
  });

  it("omits optional parameters that are empty", () => {
    const r = buildRequestUrl(op("listProducts"), SERVER, { status: "" });
    expect(r.ok && r.url).toBe("http://localhost:3000/demo-api/products");
  });

  it("places path parameters (id=17)", () => {
    const r = buildRequestUrl(op("getProductById"), SERVER, { id: 17 });
    expect(r.ok && r.url).toBe("http://localhost:3000/demo-api/products/17");
  });

  it("reports missing required parameters instead of building a URL", () => {
    const r = buildRequestUrl(op("getProductById"), SERVER, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.map((m) => m.name)).toEqual(["id"]);
  });

  it("validates types and enums", () => {
    expect(buildRequestUrl(op("getProductById"), SERVER, { id: "abc" }).ok).toBe(false);
    expect(buildRequestUrl(op("listProducts"), SERVER, { status: "cheap" }).ok).toBe(false);
  });

  it("rejects parameters the document does not declare", () => {
    const r = buildRequestUrl(op("listCategories"), SERVER, { url: "http://evil.example" });
    expect(r.ok).toBe(false);
  });

  it("encodes string path params so they cannot add path segments", () => {
    const strOp = { ...op("getProductById"), params: [{ name: "id", in: "path" as const, required: true, type: "string" as const }] };
    const r = buildRequestUrl(strOp, SERVER, { id: "../../admin?x=1" });
    expect(r.ok && r.url).toBe("http://localhost:3000/demo-api/products/..%2F..%2Fadmin%3Fx%3D1");
    expect(buildRequestUrl(strOp, SERVER, { id: ".." }).ok).toBe(false);
  });
});
