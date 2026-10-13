import { DomainError } from "../domain/errors";
import type { AppEnv } from "./context";
export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function sameOrigin(request: Request, env: AppEnv) {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    request.headers.get("Origin") !==
      (env.APP_ORIGIN || new URL(request.url).origin)
  )
    throw new DomainError(403, "invalidOrigin");
}
export async function rateLimit(
  request: Request,
  env: AppEnv,
  action: string,
  max = 10,
  seconds = 900,
) {
  const now = Math.floor(Date.now() / 1000),
    window = Math.floor(now / seconds);
  const key = await digest(
    `${action}:${request.headers.get("CF-Connecting-IP") || "local"}:${window}`,
  );
  const row = await env.DB.prepare(
    "INSERT INTO limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(key, now + seconds)
    .first<{ count: number }>();
  if (!row || row.count > max) throw new DomainError(429, "tooManyRequests");
}
export function guestCookie(token: string, secure: boolean, age = 2592000) {
  return `ow_guest=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`;
}
export async function guestSession(request: Request, env: AppEnv) {
  const token = request.headers
    .get("Cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("ow_guest="))
    ?.slice(9);
  if (!token) return null;
  return env.DB.prepare(
    "SELECT h.id,h.name,h.email,h.locale,h.revision FROM households h JOIN guest_sessions s ON s.household_id=h.id WHERE s.token_hash=? AND s.expires_at>?",
  )
    .bind(await digest(token), Date.now())
    .first<{
      id: string;
      name: string;
      email: string | null;
      locale: string;
      revision: number;
    }>();
}
export async function requireGuest(request: Request, env: AppEnv) {
  const guest = await guestSession(request, env);
  if (!guest) throw new DomainError(401, "invitationRequired");
  return guest;
}
