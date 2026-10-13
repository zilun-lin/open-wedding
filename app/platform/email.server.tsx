import { render } from "@react-email/render";
import { Resend } from "resend";
import type { EmailMessage, EmailProvider } from "../domain/ports";
import type { AppEnv } from "./context";
import { DomainError } from "../domain/errors";
export class ResendEmailProvider implements EmailProvider {
  constructor(private env: AppEnv) {}
  async send(message: EmailMessage) {
    if (!this.env.RESEND_API_KEY || !this.env.EMAIL_FROM)
      throw new DomainError(503, "emailNotConfigured");
    const result = await new Resend(this.env.RESEND_API_KEY).emails.send(
      {
        from: this.env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
      { idempotencyKey: message.idempotencyKey },
    );
    if (result.error) throw new Error(`Resend: ${result.error.name}`);
  }
}
export async function emailBody(
  title: string,
  message: string,
  siteName: string,
  origin: string,
) {
  const html = await render(
    <html>
      <body
        style={{
          fontFamily: "Arial, sans-serif",
          color: "#26372c",
          background: "#faf8f2",
          padding: 32,
        }}
      >
        <h1>{title}</h1>
        <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{message}</p>
        <p>
          <a href={origin}>{siteName}</a>
        </p>
      </body>
    </html>,
  );
  return { html, text: `${title}\n\n${message}\n\n${siteName}\n${origin}` };
}
export function outboxStatement(
  db: D1Database,
  id: string,
  to: string,
  subject: string,
  html: string,
  text: string,
) {
  return db
    .prepare(
      "INSERT OR IGNORE INTO outbox(id,recipient,subject,html,plain_text,next_attempt,created_at) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(id, to, subject, html, text, Date.now(), Date.now());
}
export async function sweepOutbox(env: AppEnv) {
  const rows = (
    await env.DB.prepare(
      "SELECT id FROM outbox WHERE status IN ('pending','sending') AND next_attempt<=? AND lease_until<=? AND attempts<5 LIMIT 50",
    )
      .bind(Date.now(), Date.now())
      .all<{ id: string }>()
  ).results;
  for (const row of rows) await env.EMAIL_QUEUE.send({ id: row.id });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM limits WHERE expires_at<?").bind(
      Math.floor(Date.now() / 1000),
    ),
    env.DB.prepare("DELETE FROM guest_sessions WHERE expires_at<?").bind(
      Date.now(),
    ),
  ]);
  // Abandoned uploads reserve quota for one hour, then release storage and records.
  const abandoned = (
    await env.DB.prepare(
      "SELECT id,object_key FROM media WHERE status IN ('uploading','receiving') AND created_at<?",
    )
      .bind(Date.now() - 3600000)
      .all<{ id: string; object_key: string }>()
  ).results;
  for (const row of abandoned) {
    await env.MEDIA.delete(row.object_key);
    await env.DB.prepare(
      "DELETE FROM media WHERE id=? AND status IN ('uploading','receiving')",
    )
      .bind(row.id)
      .run();
  }
}
export async function deliverOutbox(
  env: AppEnv,
  id: string,
  provider: EmailProvider = new ResendEmailProvider(env),
) {
  if (!env.RESEND_API_KEY && provider instanceof ResendEmailProvider) return;
  const row = await env.DB.prepare(
    "UPDATE outbox SET status='sending',lease_until=?,first_attempt_at=COALESCE(first_attempt_at,?),attempts=attempts+1 WHERE id=? AND status IN ('pending','sending') AND lease_until<=? AND next_attempt<=? AND attempts<5 RETURNING *",
  )
    .bind(Date.now() + 120000, Date.now(), id, Date.now(), Date.now())
    .first<{
      id: string;
      recipient: string;
      subject: string;
      html: string;
      plain_text: string;
      attempts: number;
      created_at: number;
      first_attempt_at: number;
    }>();
  if (!row) return;
  // Resend deduplicates keys for 24 hours. Never automatically retry an ambiguous send outside that window.
  if (row.attempts > 1 && Date.now() - row.first_attempt_at > 23 * 3600000) {
    await env.DB.prepare(
      "UPDATE outbox SET status='failed',last_error='retryWindowExpired',lease_until=0 WHERE id=?",
    )
      .bind(id)
      .run();
    return;
  }
  try {
    await provider.send({
      to: row.recipient,
      subject: row.subject,
      html: row.html,
      text: row.plain_text,
      idempotencyKey: `ow-${id}`,
    });
    await env.DB.prepare(
      "UPDATE outbox SET status='sent',lease_until=0,last_error=NULL WHERE id=?",
    )
      .bind(id)
      .run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE outbox SET status=?,lease_until=0,next_attempt=?,last_error=? WHERE id=?",
    )
      .bind(
        row.attempts >= 5 ? "failed" : "pending",
        Date.now() + Math.min(3600000, 60000 * 2 ** row.attempts),
        error instanceof Error ? error.message.slice(0, 100) : "deliveryFailed",
        id,
      )
      .run();
  }
}
