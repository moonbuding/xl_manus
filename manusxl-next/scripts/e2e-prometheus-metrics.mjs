const baseUrl = process.env.MANUSXL_E2E_BASE_URL ?? "http://localhost:3001";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function url(pathname) {
  return new URL(pathname, baseUrl).toString();
}

function findMetricLine(text, metricName) {
  return text
    .split("\n")
    .find((line) => line === metricName || line.startsWith(`${metricName} `) || line.startsWith(`${metricName}{`));
}

async function main() {
  console.log(`ManusXL Prometheus metrics E2E base URL: ${baseUrl}`);

  const response = await fetch(url("/metrics"));
  const text = await response.text();

  assert(response.ok, `/metrics 请求失败：${response.status} ${text.slice(0, 200)}`);
  assert(
    response.headers.get("content-type")?.includes("text/plain"),
    "/metrics Content-Type 不是 Prometheus text/plain"
  );

  const requiredMetrics = [
    "manusxl_build_info",
    "manusxl_tasks_total",
    "manusxl_tasks_by_status",
    "manusxl_task_success_rate",
    "manusxl_task_duration_seconds_p99",
    "manusxl_llm_calls_total",
    "manusxl_llm_estimated_cost_usd_per_minute",
    "manusxl_audit_logs_total",
    "manusxl_sandbox_pool_containers",
    "manusxl_metrics_collect_duration_ms"
  ];

  for (const metricName of requiredMetrics) {
    assert(findMetricLine(text, metricName), `缺少指标：${metricName}`);
  }

  assert(/manusxl_tasks_by_status\{status="completed"\} \d+/.test(text), "缺少 completed 状态任务指标");
  assert(!/(user_id|task_id|prompt)=/.test(text), "Prometheus 指标不应包含高基数标签");

  const totalLine = findMetricLine(text, "manusxl_tasks_total");
  const totalValue = Number(totalLine?.trim().split(/\s+/).at(-1));
  assert(Number.isFinite(totalValue) && totalValue >= 0, "任务总数指标不是有效数字");

  console.log(JSON.stringify({
    ok: true,
    endpoint: "/metrics",
    checkedMetrics: requiredMetrics.length,
    taskTotal: totalValue
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
