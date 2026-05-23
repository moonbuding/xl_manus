import { startOAuth } from "@/server/auth/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  context: { params: { provider: string } | Promise<{ provider: string }> }
) {
  return Promise.resolve(context.params).then(({ provider }) => startOAuth(provider, request));
}
