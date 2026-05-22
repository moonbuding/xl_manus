import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { listSkills, updateSkillEnabled } from "@/server/skills/skill-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  return NextResponse.json({ skills: listSkills(user.id) });
}

export async function PATCH(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const body = (await request.json()) as { skillId?: string; enabled?: boolean };
  if (!body.skillId || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "skillId and enabled are required" }, { status: 400 });
  }
  return NextResponse.json({ skills: updateSkillEnabled(body.skillId, body.enabled, user.id) });
}
