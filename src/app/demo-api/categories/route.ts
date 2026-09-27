import { NextResponse } from "next/server";
import { CATEGORIES } from "@/lib/demo-store-data";

// GET /demo-api/categories
export function GET() {
  return NextResponse.json({ count: CATEGORIES.length, items: CATEGORIES });
}
