import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface AuthSessionUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface AuthSessionPayload {
  user: AuthSessionUser;
  connectedAt: string;
  expiresAt: string;
}

export interface OAuthStatePayload {
  state: string;
  returnTo: string;
  oauthRedirectUri: string;
  createdAt: string;
}

interface CookieOptions {
  path?: string;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  secure?: boolean;
  maxAge?: number;
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function encodeSignedObject<T>(value: T, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signature = sign(encoded, secret);
  return `${encoded}.${signature}`;
}

export function decodeSignedObject<T>(token: string | undefined, secret: string): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(encoded, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (!rawName || rest.length === 0) continue;
    out[rawName] = decodeURIComponent(rest.join("="));
  }
  return out;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

export function clearCookie(name: string): string {
  return serializeCookie(name, "", { path: "/", httpOnly: true, sameSite: "Lax", maxAge: 0 });
}

export function createOAuthState(): string {
  return randomBytes(24).toString("hex");
}
