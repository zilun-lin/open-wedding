import { z } from "zod";
import type { AppEnv } from "./context";
import { auth, requireAdmin } from "./auth.server";
import {
  sameOrigin,
  digest,
  randomToken,
  guestCookie,
  requireGuest,
  guestSession,
  rateLimit,
} from "./security.server";
import { getConfig, invitedEvents } from "./config.server";
import { type WeddingConfig } from "../config/schema";
import { requireFeature } from "../config/modules";
import { DomainError } from "../domain/errors";
import { saveRsvp } from "../domain/rsvp.server";
import { parseGuestImport } from "../domain/guest-import";
import { mailDraftSchema } from "../domain/mail";
import { planMail, queueMail } from "../domain/mail.server";
import {
  planGuestImport,
  applyGuestImport,
} from "../domain/guest-import.server";
import { reserveGift } from "../domain/registry.server";
import {
  startMedia,
  uploadMedia,
  checkMediaOpen,
  type MediaRow,
} from "../domain/media.server";
import { sweepOutbox } from "./email.server";
const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
async function body(request: Request) {
  if (!request.body) throw new DomainError(400, "invalidConfiguration");
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 250000) {
        await reader.cancel();
        throw new DomainError(413, "requestTooLarge");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function audit(env: AppEnv, actor: string, action: string) {
  await env.DB.prepare(
    "INSERT INTO audit(id,actor,action,created_at) VALUES (?,?,?,?)",
  )
    .bind(crypto.randomUUID(), actor, action, Date.now())
    .run();
}
export async function handleApi(
  request: Request,
  env: AppEnv,
  ctx: ExecutionContext,
  config: WeddingConfig = getConfig(),
): Promise<Response> {
  try {
    sameOrigin(request, env);
    const url = new URL(request.url),
      path = url.pathname.slice(4),
      method = request.method;
    if (path.startsWith("/auth/")) {
      await rateLimit(request, env, "admin-auth", 60, 3600);
      return auth(env, url.origin).handler(request);
    }
    if (path === "/setup" && method === "GET")
      return json({
        configured: !!(await env.DB.prepare(
          "SELECT id FROM user WHERE role='admin' LIMIT 1",
        ).first()),
      });
    if (path === "/setup" && method === "POST") {
      await rateLimit(request, env, "setup", 5, 3600);
      const data = z
        .object({
          token: z.string().min(1),
          name: z.string().min(1).max(100),
          email: z.string().email(),
          password: z.string().min(12).max(128),
        })
        .parse(await body(request));
      if (
        !env.SETUP_TOKEN ||
        (await digest(data.token)) !== (await digest(env.SETUP_TOKEN))
      )
        throw new DomainError(403, "invalidSetupToken");
      const claim = await env.DB.prepare(
        "INSERT OR IGNORE INTO settings(key,value) SELECT 'bootstrap','claimed' WHERE NOT EXISTS(SELECT 1 FROM user)",
      ).run();
      if (!claim.meta.changes) throw new DomainError(409, "alreadyConfigured");
      try {
        const result = await auth(env, url.origin, true).api.signUpEmail({
          body: { name: data.name, email: data.email, password: data.password },
        });
        await env.DB.prepare("UPDATE user SET role='admin' WHERE id=?")
          .bind(result.user.id)
          .run();
      } catch (error) {
        await env.DB.prepare(
          "DELETE FROM settings WHERE key='bootstrap' AND NOT EXISTS(SELECT 1 FROM user)",
        ).run();
        throw error;
      }
      return json({ saved: true });
    }
    if (path === "/invitation" && method === "POST") {
      // High-entropy codes need room for guests sharing the venue's Wi-Fi.
      await rateLimit(request, env, "invitation", 120, 60);
      const { code } = z
        .object({ code: z.string().min(8).max(100) })
        .parse(await body(request));
      const row = await env.DB.prepare(
        "SELECT id FROM households WHERE code_hash=?",
      )
        .bind(await digest(code.trim()))
        .first<{ id: string }>();
      if (!row) throw new DomainError(401, "invalidInvitation");
      const token = randomToken();
      await env.DB.prepare(
        "INSERT INTO guest_sessions(token_hash,household_id,expires_at) VALUES (?,?,?)",
      )
        .bind(await digest(token), row.id, Date.now() + 2592000000)
        .run();
      return json({ saved: true }, 200, {
        "Set-Cookie": guestCookie(token, url.protocol === "https:"),
      });
    }
    if (path === "/logout" && method === "POST") {
      const token = request.headers
        .get("Cookie")
        ?.match(/(?:^|;\s*)ow_guest=([^;]+)/)?.[1];
      if (token)
        await env.DB.prepare("DELETE FROM guest_sessions WHERE token_hash=?")
          .bind(await digest(token))
          .run();
      return json({ saved: true }, 200, {
        "Set-Cookie": guestCookie("", url.protocol === "https:", 0),
      });
    }
    if (path === "/rsvp" && method === "POST") {
      const guest = await requireGuest(request, env);
      await rateLimit(request, env, `rsvp-${guest.id}`, 30, 3600);
      const result = await saveRsvp(
        env,
        config,
        guest.id,
        await body(request),
        env.APP_ORIGIN || url.origin,
      );
      ctx.waitUntil(sweepOutbox(env).catch(() => {}));
      return json(result);
    }
    if (path === "/registry/reserve" && method === "POST") {
      const guest = await requireGuest(request, env);
      const { itemId } = z
        .object({ itemId: z.string() })
        .parse(await body(request));
      return json(await reserveGift(env.DB, config, guest.id, itemId));
    }
    if (path === "/registry/update" && method === "POST") {
      requireFeature(config, "registry");
      const guest = await requireGuest(request, env);
      const { id, status } = z
        .object({
          id: z.string().uuid(),
          status: z.enum(["purchased", "cancelled"]),
        })
        .parse(await body(request));
      const result = await env.DB.prepare(
        "UPDATE reservations SET status=? WHERE id=? AND household_id=? AND ((status='reserved' AND expires_at>?) OR (status='purchased' AND ?='cancelled'))",
      )
        .bind(status, id, guest.id, Date.now(), status)
        .run();
      if (!result.meta.changes) throw new DomainError(409, "giftUnavailable");
      return json({ saved: true });
    }
    if (path === "/media/start" && method === "POST") {
      const guest = await requireGuest(request, env);
      return json(await startMedia(env, config, guest.id, await body(request)));
    }
    const file = path.match(/^\/media\/([a-f0-9-]{36})\/file$/);
    if (file && method === "POST") {
      checkMediaOpen(config);
      const guest = await requireGuest(request, env);
      return json(await uploadMedia(request, env, file[1], guest.id));
    }
    if (file && method === "GET") {
      requireFeature(config, "memories");
      const row = await env.DB.prepare("SELECT * FROM media WHERE id=?")
        .bind(file[1])
        .first<MediaRow>();
      if (!row) throw new DomainError(404, "notFound");
      if (
        row.status === "approved" &&
        Date.now() >= Date.parse(config.media.releaseAt) &&
        (await guestSession(request, env))
      ) {
      } else await requireAdmin(request, env);
      const requestedRange = request.headers.has("range");
      const object = await env.MEDIA.get(
        row.object_key,
        requestedRange ? { range: request.headers } : undefined,
      );
      if (!object) throw new DomainError(404, "notFound");
      const headers = new Headers({
        "Content-Type": row.content_type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        "Accept-Ranges": "bytes",
      });
      if (requestedRange && object.range && "offset" in object.range) {
        const offset = object.range.offset ?? 0,
          length = object.range.length ?? object.size;
        headers.set(
          "Content-Range",
          `bytes ${offset}-${offset + length - 1}/${object.size}`,
        );
        headers.set("Content-Length", String(length));
      } else headers.set("Content-Length", String(object.size));
      return new Response(object.body, {
        status: requestedRange && object.range ? 206 : 200,
        headers,
      });
    }
    if (path.startsWith("/admin/")) {
      const admin = await requireAdmin(request, env);
      if (path === "/admin/mail/plan" && method === "POST") {
        return json(
          await planMail(
            env.DB,
            mailDraftSchema.parse(await body(request)),
            config,
            env.APP_ORIGIN || url.origin,
          ),
        );
      }
      if (path === "/admin/mail/send" && method === "POST") {
        const input = z
          .object({
            draft: mailDraftSchema,
            campaignId: z.string().uuid(),
            fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
            confirm: z.literal(true),
          })
          .strict()
          .parse(await body(request));
        const previous = await env.DB.prepare(
          "SELECT fingerprint,recipient_count FROM email_campaigns WHERE id=?",
        )
          .bind(input.campaignId)
          .first<{ fingerprint: string; recipient_count: number }>();
        if (previous) {
          if (previous.fingerprint !== input.fingerprint)
            throw new DomainError(409, "campaignChanged");
          return json({
            queued: 0,
            previouslyQueued: previous.recipient_count,
            replay: true,
          });
        }
        const plan = await planMail(
          env.DB,
          input.draft,
          config,
          env.APP_ORIGIN || url.origin,
        );
        if (plan.fingerprint !== input.fingerprint)
          throw new DomainError(409, "campaignChanged");
        const result = await queueMail(
          env.DB,
          plan,
          input.campaignId,
          admin.id,
        );
        ctx.waitUntil(sweepOutbox(env).catch(() => {}));
        return json(result);
      }
      if (path === "/admin/guests/plan" && method === "POST") {
        return json(
          await planGuestImport(
            env.DB,
            parseGuestImport(await body(request), config),
          ),
        );
      }
      if (path === "/admin/guests/apply" && method === "POST") {
        const input = z
          .object({
            data: z.unknown(),
            fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
          .parse(await body(request));
        return json(
          await applyGuestImport(
            env.DB,
            parseGuestImport(input.data, config),
            input.fingerprint,
            env.APP_ORIGIN || url.origin,
            admin.id,
          ),
        );
      }
      if (path === "/admin/households" && method === "POST") {
        const data = z
          .object({
            name: z.string().min(1).max(100),
            email: z.string().email().optional().or(z.literal("")),
            locale: z.enum(["en", "zh-Hans"]),
            eventIds: z.array(z.string()).max(30),
            guests: z
              .array(
                z.object({
                  name: z.string().min(1).max(100),
                  category: z.enum(["adult", "child", "infant"]),
                }),
              )
              .min(1)
              .max(20),
          })
          .parse(await body(request));
        if (
          data.eventIds.some((id) => !config.events.some((e) => e.id === id)) ||
          !config.locales.includes(data.locale)
        )
          throw new DomainError(400, "invalidInvitation");
        const id = crypto.randomUUID(),
          code = randomToken();
        const statements = [
          env.DB.prepare(
            "INSERT INTO households(id,name,email,locale,code_hash) VALUES (?,?,?,?,?)",
          ).bind(
            id,
            data.name,
            data.email || null,
            data.locale,
            await digest(code),
          ),
        ];
        for (const guest of data.guests)
          statements.push(
            env.DB.prepare(
              "INSERT INTO guests(id,household_id,name,category) VALUES (?,?,?,?)",
            ).bind(crypto.randomUUID(), id, guest.name, guest.category),
          );
        for (const eventId of new Set(data.eventIds))
          statements.push(
            env.DB.prepare(
              "INSERT INTO invitations(household_id,event_id) VALUES (?,?)",
            ).bind(id, eventId),
          );
        await env.DB.batch(statements);
        await audit(env, admin.id, "household.created");
        return json({
          id,
          code,
          url: `${env.APP_ORIGIN || url.origin}/${data.locale}/rsvp#invite=${code}`,
        });
      }
      if (path === "/admin/revoke" && method === "POST") {
        const { id } = z
          .object({ id: z.string().uuid() })
          .parse(await body(request));
        const code = randomToken();
        await env.DB.batch([
          env.DB.prepare("UPDATE households SET code_hash=? WHERE id=?").bind(
            await digest(code),
            id,
          ),
          env.DB.prepare(
            "DELETE FROM guest_sessions WHERE household_id=?",
          ).bind(id),
        ]);
        await audit(env, admin.id, "invitation.rotated");
        return json({ code });
      }
      if (path === "/admin/table" && method === "POST") {
        requireFeature(config, "seating");
        const data = z
          .object({
            eventId: z.string(),
            name: z.string().min(1).max(100),
            capacity: z.number().int().min(1).max(100),
          })
          .parse(await body(request));
        if (!config.events.some((e) => e.id === data.eventId))
          throw new DomainError(400, "notFound");
        await env.DB.prepare(
          "INSERT INTO seating_tables(id,event_id,name,capacity) VALUES (?,?,?,?)",
        )
          .bind(crypto.randomUUID(), data.eventId, data.name, data.capacity)
          .run();
        return json({ saved: true });
      }
      if (path === "/admin/seat" && method === "POST") {
        requireFeature(config, "seating");
        const data = z
          .object({
            guestId: z.string().uuid(),
            eventId: z.string(),
            tableId: z.string().uuid().or(z.literal("")),
          })
          .parse(await body(request));
        try {
          await env.DB.batch([
            env.DB.prepare(
              "DELETE FROM seats WHERE guest_id=? AND event_id=?",
            ).bind(data.guestId, data.eventId),
            ...(data.tableId
              ? [
                  env.DB.prepare(
                    "INSERT INTO seats(guest_id,event_id,table_id) VALUES (?,?,?)",
                  ).bind(data.guestId, data.eventId, data.tableId),
                ]
              : []),
          ]);
        } catch {
          throw new DomainError(409, "tableFull");
        }
        return json({ saved: true });
      }
      if (path === "/admin/media" && method === "POST") {
        requireFeature(config, "memories");
        const data = z
          .object({
            id: z.string().uuid(),
            action: z.enum(["approve", "delete"]),
          })
          .parse(await body(request));
        const row = await env.DB.prepare(
          "SELECT * FROM media WHERE id=? AND status IN ('pending','approved')",
        )
          .bind(data.id)
          .first<MediaRow>();
        if (!row) throw new DomainError(404, "notFound");
        if (data.action === "delete") {
          await env.MEDIA.delete(row.object_key);
          await env.DB.prepare("DELETE FROM media WHERE id=?")
            .bind(row.id)
            .run();
        } else
          await env.DB.prepare("UPDATE media SET status='approved' WHERE id=?")
            .bind(row.id)
            .run();
        await audit(env, admin.id, `media.${data.action}`);
        return json({ saved: true });
      }
      if (path === "/admin/announce" && method === "POST") {
        const { confirm, ...draft } = z
          .object({
            subject: z.string(),
            message: z.string(),
            locale: z.enum(["en", "zh-Hans"]),
            eventId: z.string().optional(),
            confirm: z.literal(true),
          })
          .parse(await body(request));
        const plan = await planMail(
          env.DB,
          mailDraftSchema.parse(draft),
          config,
          env.APP_ORIGIN || url.origin,
        );
        const result = await queueMail(
          env.DB,
          plan,
          crypto.randomUUID(),
          admin.id,
        );
        ctx.waitUntil(sweepOutbox(env).catch(() => {}));
        return json(result);
      }
      if (path === "/admin/export" && method === "GET") {
        const data = {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          households: (
            await env.DB.prepare(
              "SELECT id,name,email,locale,revision FROM households",
            ).all()
          ).results,
          guests: (await env.DB.prepare("SELECT * FROM guests").all()).results,
          invitations: (await env.DB.prepare("SELECT * FROM invitations").all())
            .results,
          rsvps: (await env.DB.prepare("SELECT * FROM rsvps").all()).results,
          tables: (await env.DB.prepare("SELECT * FROM seating_tables").all())
            .results,
          seats: (await env.DB.prepare("SELECT * FROM seats").all()).results,
          reservations: (
            await env.DB.prepare("SELECT * FROM reservations").all()
          ).results,
          media: (
            await env.DB.prepare(
              "SELECT id,household_id,name,caption,status FROM media",
            ).all()
          ).results,
        };
        await audit(env, admin.id, "data.exported");
        return json(data, 200, {
          "Content-Disposition": "attachment; filename=wedding-guests.json",
        });
      }
    }
    throw new DomainError(404, "notFound");
  } catch (error) {
    // Finish bounded JSON bodies before returning an early denial. This also keeps
    // local proxy connections reusable when authorization fails before parsing.
    if (
      request.body &&
      !request.bodyUsed &&
      request.headers.get("content-type")?.includes("application/json")
    ) {
      try {
        await body(request);
      } catch {
        /* Preserve the original rejection. */
      }
    }
    if (error instanceof DomainError)
      return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError)
      return json({ error: "invalidConfiguration" }, 400);
    if (error instanceof z.ZodError)
      return json(
        {
          error: "invalidConfiguration",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    console.error(
      "Request failed",
      error instanceof Error ? error.name : "unknown",
    );
    return json({ error: "serverError" }, 500);
  }
}
