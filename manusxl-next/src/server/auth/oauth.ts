import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requestAuditContext, safeRecordAuditLog } from "@/server/audit/audit-store";
import { getAuthCookieNames, upsertOAuthUser } from "@/server/auth/auth-store";
import { getEmailDeliveryStatus } from "@/server/auth/email";
import { redirectWithSession } from "@/server/auth/http";
import type { AuthStatus, OAuthProvider } from "@/types/agent";

interface OAuthProfile {
  providerAccountId: string;
  email?: string | null;
  displayName?: string | null;
}

function providerFromParam(value: string): OAuthProvider | undefined {
  return value === "google" || value === "github" ? value : undefined;
}

function envValue(...names: string[]) {
  return names.map((name) => process.env[name]?.trim()).find(Boolean);
}

function providerConfig(provider: OAuthProvider) {
  if (provider === "google") {
    return {
      clientId: envValue("MANUSXL_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"),
      clientSecret: envValue("MANUSXL_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile"
    };
  }

  return {
    clientId: envValue("MANUSXL_GITHUB_CLIENT_ID", "GITHUB_CLIENT_ID"),
    clientSecret: envValue("MANUSXL_GITHUB_CLIENT_SECRET", "GITHUB_CLIENT_SECRET"),
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email"
  };
}

function appBaseUrl(request: Request) {
  return (
    process.env.MANUSXL_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin
  );
}

function callbackUrl(request: Request, provider: OAuthProvider) {
  return `${appBaseUrl(request)}/api/auth/oauth/${provider}/callback`;
}

function stateCookieName(provider: OAuthProvider) {
  return `manusxl_oauth_state_${provider}`;
}

function isDevelopmentOAuthRehearsal(request: Request) {
  const url = new URL(request.url);
  return process.env.NODE_ENV !== "production" && url.searchParams.get("dev") === "1";
}

function envNamesForProvider(provider: OAuthProvider) {
  return provider === "google"
    ? {
        clientId: ["MANUSXL_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"],
        clientSecret: ["MANUSXL_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"]
      }
    : {
        clientId: ["MANUSXL_GITHUB_CLIENT_ID", "GITHUB_CLIENT_ID"],
        clientSecret: ["MANUSXL_GITHUB_CLIENT_SECRET", "GITHUB_CLIENT_SECRET"]
      };
}

function parseCookies(request: Request) {
  return Object.fromEntries(
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index >= 0 ? [part.slice(0, index), decodeURIComponent(part.slice(index + 1))] : [part, ""];
      })
  );
}

export function startOAuth(providerParam: string, request: Request) {
  const provider = providerFromParam(providerParam);
  if (!provider) return NextResponse.json({ error: "Unsupported OAuth provider" }, { status: 404 });
  const config = providerConfig(provider);
  const developmentRehearsal = isDevelopmentOAuthRehearsal(request);
  if (!developmentRehearsal && (!config.clientId || !config.clientSecret)) {
    return NextResponse.json({ error: `${provider} OAuth 未配置 Client ID/Secret` }, { status: 400 });
  }

  const state = randomBytes(24).toString("base64url");
  if (developmentRehearsal) {
    const rehearsalCallbackUrl = new URL(callbackUrl(request, provider));
    rehearsalCallbackUrl.searchParams.set("code", `dev-oauth-${provider}-${Date.now().toString(36)}`);
    rehearsalCallbackUrl.searchParams.set("state", state);
    const response = NextResponse.redirect(rehearsalCallbackUrl);
    response.cookies.set(stateCookieName(provider), state, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 10 * 60
    });
    return response;
  }

  const authorizeUrl = new URL(config.authorizeUrl);
  authorizeUrl.searchParams.set("client_id", config.clientId ?? "");
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl(request, provider));
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", config.scope);
  authorizeUrl.searchParams.set("state", state);
  if (provider === "google") {
    authorizeUrl.searchParams.set("access_type", "offline");
    authorizeUrl.searchParams.set("prompt", "select_account");
  }

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(stateCookieName(provider), state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60
  });
  return response;
}

async function exchangeToken(provider: OAuthProvider, code: string, request: Request) {
  if (process.env.NODE_ENV !== "production" && code.startsWith(`dev-oauth-${provider}-`)) {
    return `dev-oauth-token:${provider}:${code}`;
  }

  const config = providerConfig(provider);
  if (!config.clientId || !config.clientSecret) {
    throw new Error(`${provider} OAuth 未配置 Client ID/Secret`);
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: callbackUrl(request, provider),
      grant_type: "authorization_code"
    })
  });
  const data = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "OAuth token exchange failed");
  }
  return data.access_token;
}

async function fetchGoogleProfile(accessToken: string): Promise<OAuthProfile> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = (await response.json()) as { sub?: string; email?: string; name?: string; error?: string };
  if (!response.ok || !data.sub) throw new Error(data.error ?? "Google userinfo failed");
  return {
    providerAccountId: data.sub,
    email: data.email,
    displayName: data.name
  };
}

async function fetchGithubProfile(accessToken: string): Promise<OAuthProfile> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "ManusXL"
  };
  const userResponse = await fetch("https://api.github.com/user", { headers });
  const user = (await userResponse.json()) as { id?: number; login?: string; name?: string; email?: string; message?: string };
  if (!userResponse.ok || !user.id) throw new Error(user.message ?? "GitHub userinfo failed");

  let email = user.email;
  if (!email) {
    const emailResponse = await fetch("https://api.github.com/user/emails", { headers });
    const emails = (await emailResponse.json()) as Array<{ email: string; primary?: boolean; verified?: boolean }>;
    email = Array.isArray(emails)
      ? emails.find((item) => item.primary && item.verified)?.email ?? emails.find((item) => item.verified)?.email
      : undefined;
  }

  return {
    providerAccountId: String(user.id),
    email,
    displayName: user.name || user.login
  };
}

async function fetchProfile(provider: OAuthProvider, accessToken: string) {
  if (process.env.NODE_ENV !== "production" && accessToken.startsWith(`dev-oauth-token:${provider}:`)) {
    return {
      providerAccountId: `dev-${provider}`,
      email: `dev-${provider}@oauth.manusxl.local`,
      displayName: `Dev ${provider}`
    };
  }
  return provider === "google" ? fetchGoogleProfile(accessToken) : fetchGithubProfile(accessToken);
}

export async function finishOAuth(providerParam: string, request: Request) {
  const provider = providerFromParam(providerParam);
  if (!provider) return NextResponse.json({ error: "Unsupported OAuth provider" }, { status: 404 });

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = parseCookies(request)[stateCookieName(provider)];

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.json({ error: "OAuth state 校验失败，请重新登录" }, { status: 400 });
  }

  try {
    const accessToken = await exchangeToken(provider, code, request);
    const profile = await fetchProfile(provider, accessToken);
    const user = upsertOAuthUser({
      provider,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      displayName: profile.displayName
    });
    safeRecordAuditLog({
      userId: user.id,
      action: "auth.oauth",
      resource: provider,
      status: "completed",
      ...requestAuditContext(request),
      metadata: {
        provider,
        providerAccountId: profile.providerAccountId,
        email: user.email
      }
    });
    const response = redirectWithSession(`${appBaseUrl(request)}/`, user.id);
    response.cookies.set(stateCookieName(provider), "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "OAuth 登录失败" },
      { status: 400 }
    );
  }
}

export function getAuthStatus(request: Request): AuthStatus {
  const baseUrl = appBaseUrl(request);
  const cookieNames = getAuthCookieNames();
  return {
    baseUrl,
    email: getEmailDeliveryStatus(),
    oauth: (["google", "github"] as OAuthProvider[]).map((provider) => {
      const config = providerConfig(provider);
      const envNames = envNamesForProvider(provider);
      return {
        provider,
        configured: Boolean(config.clientId && config.clientSecret),
        callbackUrl: callbackUrl(request, provider),
        authorizeUrl: config.authorizeUrl,
        scope: config.scope,
        missing: [
          ...(config.clientId ? [] : envNames.clientId),
          ...(config.clientSecret ? [] : envNames.clientSecret)
        ]
      };
    }),
    session: {
      ...cookieNames,
      cookieSecure: process.env.NODE_ENV === "production"
    }
  };
}
