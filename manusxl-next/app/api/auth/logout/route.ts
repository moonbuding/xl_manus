import { jsonClearingSession } from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return jsonClearingSession({ ok: true });
}
