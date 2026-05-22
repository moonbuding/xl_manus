import { NextResponse } from "next/server";
import { authenticateUser } from "@/server/auth/auth-store";
import { jsonWithSession } from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };

  try {
    const user = authenticateUser(body.email ?? "", body.password ?? "");
    return jsonWithSession({ user }, user.id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录失败" },
      { status: 401 }
    );
  }
}
