import { currentUserFromRequest, unauthorized } from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();
  return Response.json({ user });
}
