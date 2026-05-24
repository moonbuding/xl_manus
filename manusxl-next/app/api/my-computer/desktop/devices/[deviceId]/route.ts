import { NextResponse } from "next/server";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { disconnectMyComputerDesktopDevice } from "@/server/my-computer/my-computer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: { deviceId: string } | Promise<{ deviceId: string }> }
) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  const { deviceId } = await Promise.resolve(context.params);
  const result = disconnectMyComputerDesktopDevice(user.id, deviceId);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status });
}
