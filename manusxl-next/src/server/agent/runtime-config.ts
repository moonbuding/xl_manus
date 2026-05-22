const DEFAULT_TASK_TIMEOUT_MS = 31 * 60 * 1000;

export function getTaskTimeoutMs() {
  const directMs = Number(process.env.MANUSXL_TASK_TIMEOUT_MS);
  if (Number.isFinite(directMs) && directMs > 0) return Math.floor(directMs);

  const minutes = Number(process.env.MANUSXL_TASK_TIMEOUT_MINUTES ?? 31);
  if (Number.isFinite(minutes) && minutes > 0) {
    return Math.floor(minutes * 60 * 1000);
  }

  return DEFAULT_TASK_TIMEOUT_MS;
}
