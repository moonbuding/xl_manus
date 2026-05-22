import { collectPrometheusMetrics } from "@/server/metrics/prometheus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const token = process.env.MANUSXL_METRICS_TOKEN?.trim();
  if (!token) return true;

  const authorization = request.headers.get("authorization") ?? "";
  if (authorization === `Bearer ${token}`) return true;

  const url = new URL(request.url);
  return url.searchParams.get("token") === token;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new Response("unauthorized\n", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  return new Response(await collectPrometheusMetrics(), {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
