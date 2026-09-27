import { NextResponse } from "next/server";
import spec from "../../../../demo/store-openapi.json";

// Serves the bundled demo OpenAPI document so the UI can prefill it.
export function GET() {
  return NextResponse.json(spec);
}
