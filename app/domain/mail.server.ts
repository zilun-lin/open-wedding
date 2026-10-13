import type { MailDraft } from "./mail";
import { DomainError } from "./errors";
import { localize, type WeddingConfig } from "../config/schema";
import { emailBody, outboxStatement } from "../platform/email.server";
import { digest } from "../platform/security.server";

export async function planMail(
  db: D1Database,
  draft: MailDraft,
  config: WeddingConfig,
  origin: string,
) {
  if (
    !config.locales.includes(draft.locale) ||
    (draft.eventId && !config.events.some((e) => e.id === draft.eventId))
  )
    throw new DomainError(400, "invalidInvitation");
  if (draft.audience !== "all" && !config.features.rsvp)
    throw new DomainError(400, "invalidConfiguration");
  const [households, guests, invitations, rsvps] = await Promise.all([
    db
      .prepare("SELECT id,email,locale FROM households ORDER BY id")
      .all<{ id: string; email: string | null; locale: string }>(),
    db
      .prepare("SELECT id,household_id FROM guests")
      .all<{ id: string; household_id: string }>(),
    db
      .prepare("SELECT household_id,event_id FROM invitations")
      .all<{ household_id: string; event_id: string }>(),
    db
      .prepare("SELECT guest_id,event_id,attending FROM rsvps")
      .all<{ guest_id: string; event_id: string; attending: number }>(),
  ]);
  const targets = households.results.filter((h) => {
    if (h.locale !== draft.locale) return false;
    const invited = invitations.results.filter((i) => i.household_id === h.id);
    if (draft.eventId && !invited.some((i) => i.event_id === draft.eventId))
      return false;
    if (draft.audience === "all") return true;
    const events = invited.filter(
      (i) =>
        (!draft.eventId || i.event_id === draft.eventId) &&
        config.events.some((e) => e.id === i.event_id && e.rsvp),
    );
    const pairs = guests.results
      .filter((g) => g.household_id === h.id)
      .flatMap((g) =>
        events.map((e) => ({ guestId: g.id, eventId: e.event_id })),
      );
    return pairs.some((pair) => {
      const reply = rsvps.results.find(
        (r) => r.guest_id === pair.guestId && r.event_id === pair.eventId,
      );
      return draft.audience === "awaiting-rsvp"
        ? !reply
        : reply?.attending === 1;
    });
  });
  const recipients = [
    ...new Set(
      targets.flatMap((h) => (h.email ? [h.email.trim().toLowerCase()] : [])),
    ),
  ].sort();
  if (recipients.length > 500) throw new DomainError(400, "campaignTooLarge");
  const email = await emailBody(
    draft.subject,
    draft.message,
    localize(config.siteName, draft.locale),
    origin,
  );
  return {
    fingerprint: await digest(JSON.stringify({ draft, recipients, email })),
    draft,
    recipients,
    recipientCount: recipients.length,
    missingEmailHouseholds: targets.filter((h) => !h.email).length,
    html: email.html,
    text: email.text,
  };
}

export async function queueMail(
  db: D1Database,
  plan: Awaited<ReturnType<typeof planMail>>,
  campaignId: string,
  actor: string,
) {
  const previous = await db
    .prepare(
      "SELECT fingerprint,recipient_count FROM email_campaigns WHERE id=?",
    )
    .bind(campaignId)
    .first<{ fingerprint: string; recipient_count: number }>();
  if (previous) {
    if (previous.fingerprint !== plan.fingerprint)
      throw new DomainError(409, "campaignChanged");
    return {
      queued: 0,
      previouslyQueued: previous.recipient_count,
      replay: true,
    };
  }
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO email_campaigns(id,fingerprint,recipient_count,created_at) VALUES (?,?,?,?)",
        )
        .bind(campaignId, plan.fingerprint, plan.recipientCount, Date.now()),
      ...plan.recipients.map((recipient, i) =>
        outboxStatement(
          db,
          `${campaignId}:${i}`,
          recipient,
          plan.draft.subject,
          plan.html,
          plan.text,
        ),
      ),
      db
        .prepare(
          "INSERT INTO audit(id,actor,action,created_at) VALUES (?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          actor,
          `announcement.queued:${plan.recipientCount}`,
          Date.now(),
        ),
    ]);
  } catch (error) {
    if (!String(error).includes("UNIQUE constraint failed")) throw error;
    const raced = await db
      .prepare(
        "SELECT fingerprint,recipient_count FROM email_campaigns WHERE id=?",
      )
      .bind(campaignId)
      .first<{ fingerprint: string; recipient_count: number }>();
    if (!raced || raced.fingerprint !== plan.fingerprint)
      throw new DomainError(409, "campaignChanged");
    return { queued: 0, previouslyQueued: raced.recipient_count, replay: true };
  }
  return { queued: plan.recipientCount, replay: false };
}
