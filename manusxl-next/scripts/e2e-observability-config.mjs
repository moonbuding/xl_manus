import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readText(pathname) {
  return readFile(new URL(`../${pathname}`, import.meta.url), "utf8");
}

async function main() {
  const [
    prometheus,
    alertRules,
    alertmanager,
    datasource,
    dashboardProvider,
    dashboardRaw,
    compose
  ] = await Promise.all([
    readText("deploy/prometheus/prometheus.yml"),
    readText("deploy/alertmanager/rules.yml"),
    readText("deploy/alertmanager/alertmanager.yml"),
    readText("deploy/grafana/provisioning/datasources/prometheus.yml"),
    readText("deploy/grafana/provisioning/dashboards/dashboards.yml"),
    readText("deploy/grafana/dashboards/manusxl-overview.json"),
    readText("docker-compose.yml")
  ]);

  assert(compose.includes("prometheus:"), "docker-compose 缺少 prometheus service");
  assert(compose.includes("grafana:"), "docker-compose 缺少 grafana service");
  assert(compose.includes("alertmanager:"), "docker-compose 缺少 alertmanager service");
  assert(compose.includes("observability"), "监控服务没有放入 observability profile");
  assert(prometheus.includes("metrics_path: /metrics"), "Prometheus 没有抓取 /metrics");
  assert(prometheus.includes("manusxl:3000"), "Prometheus target 没有指向 manusxl:3000");
  assert(prometheus.includes("alertmanager:9093"), "Prometheus 没有配置 AlertManager");
  assert(alertRules.includes("ManusXLTaskFailureRateHigh"), "缺少任务失败率告警");
  assert(alertRules.includes("manusxl_task_failure_rate > 0.10"), "任务失败率阈值不是 10%");
  assert(alertRules.includes("ManusXLLlmErrorRateHigh"), "缺少 LLM 错误率告警");
  assert(alertRules.includes("manusxl_llm_error_rate > 0.20"), "LLM 错误率阈值不是 20%");
  assert(alertmanager.includes("receiver: critical"), "AlertManager 没有 critical route");
  assert(datasource.includes("url: http://prometheus:9090"), "Grafana datasource 没有指向 Prometheus");
  assert(dashboardProvider.includes("/var/lib/grafana/dashboards"), "Grafana dashboard provider 路径不正确");

  const dashboard = JSON.parse(dashboardRaw);
  const panelTitles = new Set((dashboard.panels ?? []).map((panel) => panel.title));
  [
    "Tasks Total",
    "Task Success Rate",
    "Tasks by Status",
    "Task Duration",
    "LLM Cost per Minute",
    "LLM Error Rate",
    "Sandbox Health",
    "Audit Health"
  ].forEach((title) => assert(panelTitles.has(title), `Dashboard 缺少面板：${title}`));

  assert(!/(user_id|task_id|prompt)/.test(dashboardRaw), "Dashboard 不应使用高基数字段");

  console.log(JSON.stringify({
    ok: true,
    dashboard: dashboard.title,
    panels: dashboard.panels.length,
    alerts: (alertRules.match(/alert: /g) ?? []).length
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
