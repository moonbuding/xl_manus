import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { currentUserFromRequest, unauthorized } from "@/server/auth/http";
import { updateAppConfig } from "@/server/config/app-config";
import { getDeepSeekConfig } from "@/server/llm/deepseek";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const config = getDeepSeekConfig();
  const user = currentUserFromRequest(request);
  return NextResponse.json({
    model: config.model,
    baseUrl: config.baseUrl,
    temperature: config.temperature,
    maxSteps: config.maxSteps,
    taskBudgetUsd: config.taskBudgetUsd,
    planningModel: config.planningModel,
    executionModel: config.executionModel,
    finalModel: config.finalModel,
    promptCacheEnabled: config.promptCacheEnabled,
    localBrowserDomainAllowlist: config.localBrowserDomainAllowlist,
    myComputerAllowedRoots: user ? config.myComputerAllowedRoots : [],
    myComputerPaused: user ? config.myComputerPaused : true,
    designImageProvider: user ? config.designImageProvider : "local",
    designImageMaxPerTask: user ? config.designImageMaxPerTask : 4,
    hasDesignImageApiKey: user ? Boolean(config.designImageApiKey) : false,
    hasApiKey: Boolean(config.apiKey)
  });
}

export async function PATCH(request: Request) {
  const user = currentUserFromRequest(request);
  if (!user) return unauthorized();

  const body = (await request.json()) as {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    temperature?: number;
    maxSteps?: number;
    taskBudgetUsd?: number;
    planningModel?: string;
    executionModel?: string;
    finalModel?: string;
    promptCacheEnabled?: boolean;
    localBrowserDomainAllowlist?: string[];
    myComputerAllowedRoots?: string[];
    myComputerPaused?: boolean;
    designImageProvider?: string;
    designImageApiKey?: string;
    designImageMaxPerTask?: number;
  };
  const config = updateAppConfig({
    apiKey: body.apiKey,
    model: body.model,
    baseUrl: body.baseUrl,
    temperature: body.temperature,
    maxSteps: body.maxSteps,
    taskBudgetUsd: body.taskBudgetUsd,
    planningModel: body.planningModel,
    executionModel: body.executionModel,
    finalModel: body.finalModel,
    promptCacheEnabled: body.promptCacheEnabled,
    localBrowserDomainAllowlist: body.localBrowserDomainAllowlist,
    myComputerAllowedRoots: body.myComputerAllowedRoots,
    myComputerPaused: body.myComputerPaused,
    designImageProvider: body.designImageProvider,
    designImageApiKey: body.designImageApiKey,
    designImageMaxPerTask: body.designImageMaxPerTask
  });
  safeRecordAuditLog({
    userId: user.id,
    action: "config.update",
    resource: "app_config",
    status: "completed",
    ...requestAuditContext(request),
    metadata: {
      fields: Object.keys(body).filter((key) => body[key as keyof typeof body] !== undefined),
      hasApiKeyUpdate: Boolean(body.apiKey)
    }
  });

  return NextResponse.json({
    model: config.model,
    baseUrl: config.baseUrl,
    temperature: config.temperature,
    maxSteps: config.maxSteps,
    taskBudgetUsd: config.taskBudgetUsd,
    planningModel: config.planningModel,
    executionModel: config.executionModel,
    finalModel: config.finalModel,
    promptCacheEnabled: config.promptCacheEnabled,
    localBrowserDomainAllowlist: config.localBrowserDomainAllowlist,
    myComputerAllowedRoots: config.myComputerAllowedRoots,
    myComputerPaused: config.myComputerPaused,
    designImageProvider: config.designImageProvider,
    designImageMaxPerTask: config.designImageMaxPerTask,
    hasDesignImageApiKey: Boolean(config.designImageApiKey),
    hasApiKey: Boolean(config.apiKey)
  });
}
