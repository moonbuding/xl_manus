import { NextResponse } from "next/server";
import {
  getAuthCookieNames,
  makeSessionTokens,
  readAuthUserFromAccessToken,
  readAuthUserFromCookieHeader
} from "@/server/auth/auth-store";
import type { AuthUser } from "@/types/agent";

export function currentUserFromRequest(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  return readAuthUserFromAccessToken(bearer) ?? readAuthUserFromCookieHeader(request.headers.get("cookie"));
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function requireAuth(request: Request): AuthUser | NextResponse {
  return currentUserFromRequest(request) ?? unauthorized();
}

export function jsonWithSession(body: unknown, userId: string) {
  const tokens = makeSessionTokens(userId);
  const responseBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? { ...body, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }
      : body;
  const response = NextResponse.json(responseBody);
  const {
    accessCookieName,
    refreshCookieName,
    accessMaxAgeSeconds,
    refreshMaxAgeSeconds
  } = getAuthCookieNames();

  response.cookies.set(accessCookieName, tokens.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: accessMaxAgeSeconds
  });
  response.cookies.set(refreshCookieName, tokens.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: refreshMaxAgeSeconds
  });
  return response;
}

export function jsonClearingSession(body: unknown) {
  const response = NextResponse.json(body);
  const { accessCookieName, refreshCookieName } = getAuthCookieNames();
  response.cookies.set(accessCookieName, "", { httpOnly: true, path: "/", maxAge: 0 });
  response.cookies.set(refreshCookieName, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

export function redirectWithSession(url: string, userId: string) {
  const tokens = makeSessionTokens(userId);
  const response = NextResponse.redirect(url);
  const {
    accessCookieName,
    refreshCookieName,
    accessMaxAgeSeconds,
    refreshMaxAgeSeconds
  } = getAuthCookieNames();

  response.cookies.set(accessCookieName, tokens.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: accessMaxAgeSeconds
  });
  response.cookies.set(refreshCookieName, tokens.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: refreshMaxAgeSeconds
  });
  return response;
}
