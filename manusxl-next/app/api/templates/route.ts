import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { createTemplate, listTemplates } from "@/server/templates/template-store";
import type { CreateTemplateRequest } from "@/types/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  return NextResponse.json({ templates: listTemplates(url.searchParams.get("q") ?? undefined, user.id) });
}

export async function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const body = (await request.json()) as Partial<CreateTemplateRequest>;
  const promptTemplate = body.promptTemplate?.trim();

  if (!promptTemplate) {
    return NextResponse.json({ error: "Prompt template is required" }, { status: 400 });
  }

  return NextResponse.json(
    createTemplate({
      name: body.name ?? "未命名模板",
      description: body.description,
      promptTemplate,
      defaultModel: body.defaultModel,
      tags: body.tags
    }, user.id)
  );
}
