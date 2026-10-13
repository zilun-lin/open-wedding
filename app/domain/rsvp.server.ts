import { z } from "zod";
import type { AppEnv } from "../platform/context";
import type { WeddingConfig } from "../config/schema";
import { localize } from "../config/schema";
import { requireFeature } from "../config/modules";
import { invitedEvents } from "../platform/config.server";
import { emailBody } from "../platform/email.server";
import { DomainError } from "./errors";
export const rsvpSchema = z.object({
  submissionId: z.string().uuid(),
  revision: z.number().int().min(0),
  email: z.string().email(),
  locale: z.enum(["en", "zh-Hans"]),
  answers: z
    .array(
      z.object({
        guestId: z.string().uuid(),
        eventId: z.string().max(60),
        attending: z.boolean(),
        meal: z.string().max(100),
        dietary: z.string().max(500),
        accessibility: z.string().max(500),
        transport: z.string().max(100),
      }),
    )
    .max(300),
});
export async function saveRsvp(
  env: AppEnv,
  config: WeddingConfig,
  householdId: string,
  input: unknown,
  origin: string,
) {
  requireFeature(config, "rsvp");
  const data = rsvpSchema.parse(input);
  for (const answer of data.answers)
    if (!answer.attending) {
      answer.meal = "";
      answer.dietary = "";
      answer.accessibility = "";
      answer.transport = "";
    }
  if (!config.locales.includes(data.locale))
    throw new DomainError(400, "invalidLanguage");
  const existing = await env.DB.prepare(
    "SELECT household_id FROM submissions WHERE id=?",
  )
    .bind(data.submissionId)
    .first<{ household_id: string }>();
  if (existing && existing.household_id !== householdId)
    throw new DomainError(409, "rsvpConflict");
  if (existing) return { saved: true, replay: true };
  if (Date.now() > Date.parse(config.rsvpDeadline))
    throw new DomainError(409, "rsvpClosed");
  const invited = await invitedEvents(env.DB, householdId);
  const events = config.events.filter(
    (event) => event.rsvp && invited.includes(event.id),
  );
  const guests = (
    await env.DB.prepare("SELECT id,name FROM guests WHERE household_id=?")
      .bind(householdId)
      .all<{ id: string; name: string }>()
  ).results;
  const expected = new Set(
    guests.flatMap((guest) => events.map((event) => `${guest.id}:${event.id}`)),
  );
  if (
    !expected.size ||
    data.answers.length !== expected.size ||
    new Set(data.answers.map((a) => `${a.guestId}:${a.eventId}`)).size !==
      expected.size ||
    data.answers.some((a) => !expected.has(`${a.guestId}:${a.eventId}`))
  )
    throw new DomainError(403, "invalidInvitation");
  const subject =
    data.locale === "en" ? "Your RSVP is saved" : "您的出席回复已保存";
  const summary = data.answers
    .map(
      (answer) =>
        `${guests.find((g) => g.id === answer.guestId)!.name} · ${localize(events.find((e) => e.id === answer.eventId)!.name, data.locale)}: ${answer.attending ? (data.locale === "en" ? "Attending" : "出席") : data.locale === "en" ? "Unable to attend" : "无法出席"}`,
    )
    .join("\n");
  const body = await emailBody(
    subject,
    summary,
    localize(config.siteName, data.locale),
    origin,
  );
  const condition =
    "EXISTS(SELECT 1 FROM households WHERE id=? AND revision=? AND last_submission=?)";
  const gate = [householdId, data.revision + 1, data.submissionId];
  const statements = [
    env.DB.prepare(
      "UPDATE households SET revision=revision+1,last_submission=?,email=?,locale=? WHERE id=? AND revision=?",
    ).bind(
      data.submissionId,
      data.email,
      data.locale,
      householdId,
      data.revision,
    ),
  ];
  for (const answer of data.answers)
    statements.push(
      env.DB.prepare(
        `INSERT INTO rsvps(guest_id,event_id,attending,meal,dietary,accessibility,transport) SELECT ?,?,?,?,?,?,? WHERE ${condition} ON CONFLICT(guest_id,event_id) DO UPDATE SET attending=excluded.attending,meal=excluded.meal,dietary=excluded.dietary,accessibility=excluded.accessibility,transport=excluded.transport`,
      ).bind(
        answer.guestId,
        answer.eventId,
        Number(answer.attending),
        answer.meal,
        answer.dietary,
        answer.accessibility,
        answer.transport,
        ...gate,
      ),
    );
  statements.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO submissions(id,household_id,created_at) SELECT ?,?,? WHERE ${condition}`,
    ).bind(data.submissionId, householdId, Date.now(), ...gate),
  );
  statements.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO outbox(id,recipient,subject,html,plain_text,next_attempt,created_at) SELECT ?,?,?,?,?,?,? WHERE ${condition}`,
    ).bind(
      data.submissionId,
      data.email,
      subject,
      body.html,
      body.text,
      Date.now(),
      Date.now(),
      ...gate,
    ),
  );
  const result = await env.DB.batch(statements);
  if (!result[0].meta.changes) throw new DomainError(409, "rsvpConflict");
  return { saved: true, replay: false };
}
