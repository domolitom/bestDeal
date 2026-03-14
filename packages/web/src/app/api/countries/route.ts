import { NextResponse } from "next/server";
import { storage } from "@/lib/storage";

export const runtime = "edge";

export async function GET() {
  const countries = await storage.listCountries();
  return NextResponse.json(countries);
}
