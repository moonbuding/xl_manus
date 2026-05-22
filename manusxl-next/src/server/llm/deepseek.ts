import { getAppConfig } from "@/server/config/app-config";
import { recordContextMetric } from "@/server/metrics/context-metrics";

type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface DeepSeekChatOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  fallback: string;
  taskId?: string;
  stage?: string;
  promptCacheEnabled?: boolean;
  signal?: AbortSignal;
}

interface DeepSeekErrorInfo {
  type: "network_error" | "http_error" | "invalid_response";
  status?: number;
  statusText?: string;
  code?: string;
  message: string;
}

async function readErrorBody(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return "";

  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; code?: string };
      message?: string;
      code?: string;
    };
    return parsed.error?.message ?? parsed.message ?? parsed.error?.code ?? parsed.code ?? text;
  } catch {
    return text;
  }
}

function networkErrorInfo(error: unknown): DeepSeekErrorInfo {
  const candidate = error as { message?: string; cause?: { code?: string; message?: string } };
  return {
    type: "network_error",
    code: candidate.cause?.code,
    message: (candidate.cause?.message ?? candidate.message ?? "DeepSeek 网络请求失败").slice(0, 500)
  };
}

function httpErrorInfo(response: Response, message: string): DeepSeekErrorInfo {
  return {
    type: "http_error",
    status: response.status,
    statusText: response.statusText,
    message: message.slice(0, 500)
  };
}

function invalidResponseInfo(message: string): DeepSeekErrorInfo {
  return {
    type: "invalid_response",
    message: message.slice(0, 500)
  };
}

function fallbackMetricMetadata(error: DeepSeekErrorInfo) {
  return {
    errorType: error.type,
    status: error.status,
    statusText: error.statusText,
    code: error.code,
    message: error.message
  };
}

function deepSeekV4Options(model: string) {
  if (!model.startsWith("deepseek-v4")) return {};
  return {
    thinking: {
      type: process.env.MANUSXL_DEEPSEEK_THINKING === "enabled" ? "enabled" : "disabled"
    }
  };
}

export function getDeepSeekConfig() {
  const config = getAppConfig();
  return {
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
    temperature: config.temperature,
    maxSteps: config.maxSteps,
    taskBudgetUsd: config.taskBudgetUsd,
    planningModel: config.planningModel,
    executionModel: config.executionModel,
    finalModel: config.finalModel,
    promptCacheEnabled: config.promptCacheEnabled,
    localBrowserDomainAllowlist: config.localBrowserDomainAllowlist
  };
}

export async function chatWithDeepSeek(options: DeepSeekChatOptions) {
  const config = getDeepSeekConfig();
  const model = options.model ?? config.model;
  const startedAt = Date.now();

  if (options.signal?.aborted) {
    throw new Error("LLM request aborted");
  }

  if (!config.apiKey) {
    recordContextMetric({
      taskId: options.taskId,
      stage: options.stage,
      provider: "local_fallback",
      model,
      messages: options.messages,
      promptCacheEnabled: options.promptCacheEnabled ?? config.promptCacheEnabled,
      fallbackUsed: true,
      latencyMs: Date.now() - startedAt
    });
    return options.fallback;
  }

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: options.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 1200,
        ...deepSeekV4Options(model)
      })
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw error instanceof Error ? error : new Error("LLM request aborted");
    }
    const errorInfo = networkErrorInfo(error);

    recordContextMetric({
      taskId: options.taskId,
      stage: options.stage,
      provider: "deepseek_error",
      model,
      messages: options.messages,
      promptCacheEnabled: options.promptCacheEnabled ?? config.promptCacheEnabled,
      fallbackUsed: true,
      latencyMs: Date.now() - startedAt,
      metadata: fallbackMetricMetadata(errorInfo)
    });
    return options.fallback;
  }

  if (!response.ok) {
    const errorInfo = httpErrorInfo(response, await readErrorBody(response));
    recordContextMetric({
      taskId: options.taskId,
      stage: options.stage,
      provider: "deepseek_error",
      model,
      messages: options.messages,
      promptCacheEnabled: options.promptCacheEnabled ?? config.promptCacheEnabled,
      fallbackUsed: true,
      latencyMs: Date.now() - startedAt,
      metadata: fallbackMetricMetadata(errorInfo)
    });
    return options.fallback;
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_cache_miss_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      prompt_tokens_details?: {
        cached_tokens?: number;
      };
    };
  };

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    const errorInfo = invalidResponseInfo("DeepSeek 返回成功响应，但没有 choices[0].message.content。");
    recordContextMetric({
      taskId: options.taskId,
      stage: options.stage,
      provider: "deepseek_error",
      model,
      messages: options.messages,
      usage: data.usage,
      promptCacheEnabled: options.promptCacheEnabled ?? config.promptCacheEnabled,
      fallbackUsed: true,
      latencyMs: Date.now() - startedAt,
      metadata: fallbackMetricMetadata(errorInfo)
    });
    return options.fallback;
  }

  recordContextMetric({
    taskId: options.taskId,
    stage: options.stage,
    provider: "deepseek",
    model,
    messages: options.messages,
    usage: data.usage,
    promptCacheEnabled: options.promptCacheEnabled ?? config.promptCacheEnabled,
    fallbackUsed: false,
    latencyMs: Date.now() - startedAt
  });

  return content;
}

export async function testDeepSeekConnection(signal?: AbortSignal) {
  const config = getDeepSeekConfig();
  const model = config.model;
  const startedAt = Date.now();

  if (!config.apiKey) {
    return {
      ok: false,
      model,
      baseUrl: config.baseUrl,
      latencyMs: 0,
      error: {
        type: "missing_api_key",
        message: "未配置 DeepSeek API Key。"
      }
    };
  }

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a connection test endpoint." },
          { role: "user", content: "Reply with OK." }
        ],
        temperature: 0,
        max_tokens: 8,
        ...deepSeekV4Options(model)
      })
    });
  } catch (error) {
    return {
      ok: false,
      model,
      baseUrl: config.baseUrl,
      latencyMs: Date.now() - startedAt,
      error: networkErrorInfo(error)
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      model,
      baseUrl: config.baseUrl,
      latencyMs: Date.now() - startedAt,
      error: httpErrorInfo(response, await readErrorBody(response))
    };
  }

  const data = (await response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null;
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return {
      ok: false,
      model,
      baseUrl: config.baseUrl,
      latencyMs: Date.now() - startedAt,
      error: invalidResponseInfo("DeepSeek 返回成功响应，但没有可读文本。")
    };
  }

  return {
    ok: true,
    model,
    baseUrl: config.baseUrl,
    latencyMs: Date.now() - startedAt,
    sample: content.slice(0, 80)
  };
}
