import { NextResponse, type NextRequest } from "next/server";
import { storage } from "@/lib/storage";
import type { CatalogFilter, CatalogStatus } from "@bestdeal/shared";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const filter: CatalogFilter = {};
  const country = searchParams.get("country");
  const store = searchParams.get("store");
  const status = searchParams.get("status");

  if (country) filter.country = country;
  if (store) filter.store = store;
  if (status) filter.status = status as CatalogStatus;

  const catalogs = await storage.listCatalogs(filter);
  return NextResponse.json(catalogs);
}
