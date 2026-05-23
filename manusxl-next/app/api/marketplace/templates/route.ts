import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import {
  listMarketplaceTemplates,
  type MarketplaceTemplateSort
} from "@/server/templates/template-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseSort(value: string | null): MarketplaceTemplateSort {
  if (value === "popular" || value === "topRated" || value === "latest") return value;
  return "featured";
}

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  return NextResponse.json({
    templates: listMarketplaceTemplates({
      query: url.searchParams.get("q") ?? undefined,
      tag: url.searchParams.get("tag") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      sort: parseSort(url.searchParams.get("sort"))
    })
  });
}
