import { NextResponse } from "next/server";
import { createUser } from "@/server/auth/auth-store";
import { sendVerificationEmail } from "@/server/auth/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    email?: string;
    password?: string;
    displayName?: string;
  };

  try {
    const result = createUser({
      email: body.email ?? "",
      password: body.password ?? "",
      displayName: body.displayName
    });
    const emailDelivery = await sendVerificationEmail({
      email: result.user.email,
      displayName: result.user.displayName,
      verificationCode: result.verificationCode
    });
    if (!emailDelivery.ok && !emailDelivery.verificationCodeExposed) {
      return NextResponse.json(
        { error: emailDelivery.error ?? "验证邮件发送失败" },
        { status: 502 }
      );
    }
    return NextResponse.json({
      user: result.user,
      emailDelivery: {
        mode: emailDelivery.mode,
        sent: emailDelivery.sent,
        error: emailDelivery.error
      },
      verificationCode: emailDelivery.verificationCodeExposed ? result.verificationCode : undefined
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "注册失败" },
      { status: 400 }
    );
  }
}
