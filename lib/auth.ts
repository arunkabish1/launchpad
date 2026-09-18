import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import type { GlobalRole, SessionUser } from "./types";

const COOKIE_NAME = "launchpad_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type { SessionUser } from "./types";

function sessionSecret(): string | null {
  return (
    process.env.LAUNCHPAD_SESSION_SECRET?.trim() ||
    process.env.LAUNCHPAD_SECRET?.trim() ||
    null
  );
}

export function getAdminPassword(): string {
  return process.env.LAUNCHPAD_ADMIN_PASSWORD ?? "";
}

export function isAdminPasswordSet(): boolean {
  return Boolean(getAdminPassword());
}

export function verifyPassword(password: string, expected: string): boolean {
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function sign(payload: string): string {
  const secret = sessionSecret();
  if (!secret) throw new Error("No session secret configured (set LAUNCHPAD_SECRET).");
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(user: SessionUser): string {
  const payload = Buffer.from(
    JSON.stringify({
      uid: user.id,
      uname: user.username,
      urole: user.globalRole,
      exp: Date.now() + SESSION_TTL_MS,
    })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function parseSessionToken(token: string): SessionUser | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      uid?: string;
      uname?: string;
      urole?: string;
      exp?: number;
    };
    if (!data.exp || data.exp < Date.now()) return null;
    if (!data.uid || !data.uname) return null;
    return {
      id: data.uid,
      username: data.uname,
      globalRole: (data.urole as GlobalRole) === "admin" ? "admin" : "member",
    };
  } catch {
    return null;
  }
}

export function actorName(name: string | undefined): string {
  return name?.trim() ? name.trim().slice(0, 60) : "admin";
}

export type AuthResult =
  | { ok: true; actor: string; user: SessionUser }
  | { ok: false; error: string };

export function requireAuth(req: NextRequest): AuthResult {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return { ok: false, error: "Authentication required. Please log in." };
  const user = parseSessionToken(token);
  if (!user) return { ok: false, error: "Invalid or expired session. Please log in again." };
  return { ok: true, actor: user.username, user };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return parseSessionToken(token);
}

export function verifyOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const source = origin ?? referer;
  if (!source) return true;
  const host = req.headers.get("host");
  if (!host) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

export function authRequiredResponse(): NextResponse {
  return NextResponse.json({ error: "Authentication required. Please log in." }, { status: 401 });
}

export { COOKIE_NAME };
