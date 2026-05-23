import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/http";
import { getMyComputerStatus } from "@/server/my-computer/my-computer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = requireAuth(request);
  if (user instanceof NextResponse) return user;
  return NextResponse.json(await getMyComputerStatus(user.id));
}
