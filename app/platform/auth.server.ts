import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./auth-schema";
import type { AppEnv } from "./context";
import { DomainError } from "../domain/errors";
import { emailBody, outboxStatement } from "./email.server";
export function auth(env: AppEnv, origin: string, bootstrap = false) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32)
    throw new DomainError(503, "authenticationUnavailable");
  return betterAuth({
    secret: env.AUTH_SECRET,
    baseURL: env.APP_ORIGIN || origin,
    trustedOrigins: [env.APP_ORIGIN || origin],
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: "sqlite",
      schema,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !bootstrap,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        if (!env.RESEND_API_KEY || !env.EMAIL_FROM)
          throw new DomainError(503, "emailNotConfigured");
        const id = crypto.randomUUID(),
          subject = "Reset your host password / 重设主人密码";
        const body = await emailBody(
          subject,
          `Use this private link to reset your password.\n请使用此专属链接重设密码。\n\n${url}`,
          "Open Wedding",
          env.APP_ORIGIN || origin,
        );
        await outboxStatement(
          env.DB,
          id,
          user.email,
          subject,
          body.html,
          body.text,
        ).run();
        await env.EMAIL_QUEUE.send({ id }).catch(() => {});
      },
    },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "viewer", input: false },
      },
    },
    rateLimit: { enabled: true, storage: "database" },
  });
}
export async function requireAdmin(request: Request, env: AppEnv) {
  const current = await auth(env, new URL(request.url).origin).api.getSession({
    headers: request.headers,
  });
  if (!current || current.user.role !== "admin")
    throw new DomainError(401, "adminRequired");
  return current.user;
}
