import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { saveAndAnalyzeUpload } from "@/server/files/readers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = currentUserFromRequest(request);
    if (!user) return unauthorized();

    const formData = await request.formData();
    const upload = formData.get("file");

    if (!(upload instanceof File)) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    const file = await saveAndAnalyzeUpload(upload, user.id);
    return NextResponse.json({ file });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "文件解析失败" },
      { status: 400 }
    );
  }
}
