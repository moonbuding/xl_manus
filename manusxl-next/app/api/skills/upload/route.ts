import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { installSkillZip } from "@/server/skills/skill-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传 .zip 格式的 Skill 包" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return NextResponse.json({ error: "Skill 包必须是 .zip 文件" }, { status: 400 });
  }

  try {
    const result = installSkillZip({
      filename: file.name,
      buffer: Buffer.from(await file.arrayBuffer())
    }, user.id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Skill 上传失败" },
      { status: 400 }
    );
  }
}
