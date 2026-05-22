import { NextResponse } from "next/server";
import { createUser } from "@/server/auth/auth-store";

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
    return NextResponse.json({
      user: result.user,
      verificationCode: result.verificationCode
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "注册失败" },
      { status: 400 }
    );
  }
}
