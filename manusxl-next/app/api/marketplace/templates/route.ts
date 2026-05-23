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
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? "10"), 50));
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const offset = (page - 1) * limit;
  const templates = listMarketplaceTemplates({
    query: url.searchParams.get("q") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    sort: parseSort(url.searchParams.get("sort")),
    viewerId: user.id
  });
  return NextResponse.json({
    templates: templates.slice(offset, offset + limit),
    total: templates.length,
    page,
    pageSize: limit
  });
}
