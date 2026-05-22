import { NextResponse } from "next/server";
import { verifyPhoneLogin } from "@/server/auth/auth-store";
import { jsonWithSession } from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { phone?: string; verificationCode?: string; code?: string };

  try {
    const user = verifyPhoneLogin({
      phone: body.phone ?? "",
      code: body.verificationCode ?? body.code ?? ""
    });
    return jsonWithSession({ user }, user.id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录失败" },
      { status: 400 }
    );
  }
}
