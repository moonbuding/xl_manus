import { NextResponse } from "next/server";
import { requestPhoneLoginCode } from "@/server/auth/auth-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { phone?: string };

  try {
    const result = requestPhoneLoginCode({ phone: body.phone ?? "" });
    return NextResponse.json({
      user: result.user,
      verificationCode: result.verificationCode
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取验证码失败" },
      { status: 400 }
    );
  }
}
