import { NextResponse, type NextRequest } from "next/server";
import { storage } from "@/lib/storage";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const country = request.nextUrl.searchParams.get("country");
  if (!country) {
    return NextResponse.json(
      { error: "country parameter required" },
      { status: 400 }
    );
  }
  const stores = await storage.listStores(country);
  return NextResponse.json(stores);
}
