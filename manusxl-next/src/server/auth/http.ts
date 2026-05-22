import { NextResponse } from "next/server";
import {
  getAuthCookieNames,
  makeSessionTokens,
  readAuthUserFromCookieHeader
} from "@/server/auth/auth-store";
import type { AuthUser } from "@/types/agent";

export function currentUserFromRequest(request: Request) {
  return readAuthUserFromCookieHeader(request.headers.get("cookie"));
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function requireAuth(request: Request): AuthUser | NextResponse {
  return currentUserFromRequest(request) ?? unauthorized();
}

export function jsonWithSession(body: unknown, userId: string) {
  const response = NextResponse.json(body);
  const { accessToken, refreshToken } = makeSessionTokens(userId);
  const {
    accessCookieName,
    refreshCookieName,
    accessMaxAgeSeconds,
    refreshMaxAgeSeconds
  } = getAuthCookieNames();

  response.cookies.set(accessCookieName, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: accessMaxAgeSeconds
  });
  response.cookies.set(refreshCookieName, refreshToken, {
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
