import { type GuestImport } from "./guest-import";
import { DomainError } from "./errors";
import { digest, randomToken } from "../platform/security.server";

interface HouseholdRow {
  id: string;
  name: string;
  email: string | null;
  locale: string;
  code_hash: string;
  revision: number;
}
interface GuestRow {
  id: string;
  household_id: string;
  name: string;
  category: string;
}
interface InvitationRow {
  household_id: string;
  event_id: string;
}

async function snapshot(db: D1Database) {
  const [households, guests, invitations] = await Promise.all([
    db
      .prepare(
        "SELECT id,name,email,locale,code_hash,revision FROM households ORDER BY id",
      )
      .all<HouseholdRow>(),
    db
      .prepare("SELECT id,household_id,name,category FROM guests ORDER BY id")
      .all<GuestRow>(),
    db
      .prepare(
        "SELECT household_id,event_id FROM invitations ORDER BY household_id,event_id",
      )
      .all<InvitationRow>(),
  ]);
  return {
    households: households.results,
    guests: guests.results,
    invitations: invitations.results,
  };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
const members = (state: Snapshot, id: string) =>
  state.guests.filter((g) => g.household_id === id);
const events = (state: Snapshot, id: string) =>
  state.invitations.filter((i) => i.household_id === id).map((i) => i.event_id);

async function review(data: GuestImport, state: Snapshot) {
  const changes: {
    householdId: string;
    name: string;
    action: "create" | "update" | "unchanged";
    fields: string[];
    guestsAdded: number;
    invitationsAdded: number;
  }[] = [];
  const conflicts: {
    householdId: string;
    reason: string;
    recordId?: string;
  }[] = [];
  const warnings: { householdId: string; reason: string }[] = [];
  for (const h of data.households) {
    const current = state.households.find((row) => row.id === h.id),
      oldGuests = members(state, h.id),
      oldEvents = events(state, h.id);
    const fields: string[] = [];
    if (current) {
      for (const field of ["name", "email", "locale"] as const)
        if (current[field] !== h[field]) fields.push(field);
      for (const guest of oldGuests)
        if (!h.guests.some((g) => g.id === guest.id))
          conflicts.push({
            householdId: h.id,
            reason: "guestRemovalRequiresReview",
            recordId: guest.id,
          });
      for (const event of oldEvents)
        if (!h.eventIds.includes(event))
          conflicts.push({
            householdId: h.id,
            reason: "invitationRemovalRequiresReview",
            recordId: event,
          });
    }
    for (const guest of h.guests) {
      const found = state.guests.find((g) => g.id === guest.id);
      if (found && found.household_id !== h.id)
        conflicts.push({
          householdId: h.id,
          reason: "guestBelongsToAnotherHousehold",
          recordId: guest.id,
        });
      else if (
        found &&
        (found.name !== guest.name || found.category !== guest.category)
      )
        fields.push(`guest:${guest.id}`);
    }
    const guestsAdded = h.guests.filter(
      (g) => !oldGuests.some((old) => old.id === g.id),
    ).length;
    const invitationsAdded = h.eventIds.filter(
      (id) => !oldEvents.includes(id),
    ).length;
    const action = !current
      ? "create"
      : fields.length || guestsAdded || invitationsAdded
        ? "update"
        : "unchanged";
    changes.push({
      householdId: h.id,
      name: h.name,
      action,
      fields,
      guestsAdded,
      invitationsAdded,
    });
    if (!h.email)
      warnings.push({ householdId: h.id, reason: "noEmailUsePrivateLink" });
    if (
      h.email &&
      (data.households.some(
        (other) => other.id !== h.id && other.email === h.email,
      ) ||
        state.households.some(
          (other) =>
            other.id !== h.id &&
            other.email?.toLowerCase() === h.email &&
            !data.households.some(
              (replacement) =>
                replacement.id === other.id && replacement.email !== h.email,
            ),
        ))
    )
      warnings.push({
        householdId: h.id,
        reason: "sharedEmailCheckHouseholdGrouping",
      });
  }
  const householdIds = new Set(data.households.map((h) => h.id));
  const guestIds = new Set(
    data.households.flatMap((h) => h.guests.map((g) => g.id)),
  );
  const relevant = {
    households: state.households.filter((h) => householdIds.has(h.id)),
    guests: state.guests.filter(
      (g) => householdIds.has(g.household_id) || guestIds.has(g.id),
    ),
    invitations: state.invitations.filter((i) =>
      householdIds.has(i.household_id),
    ),
  };
  return {
    schemaVersion: 1,
    fingerprint: await digest(
      JSON.stringify({ data, state: relevant, conflicts, warnings }),
    ),
    summary: {
      create: changes.filter((c) => c.action === "create").length,
      update: changes.filter((c) => c.action === "update").length,
      unchanged: changes.filter((c) => c.action === "unchanged").length,
      guestsAdded: changes.reduce((n, c) => n + c.guestsAdded, 0),
      invitationsAdded: changes.reduce((n, c) => n + c.invitationsAdded, 0),
    },
    changes,
    conflicts,
    warnings,
  };
}

export async function planGuestImport(db: D1Database, data: GuestImport) {
  return review(data, await snapshot(db));
}

export async function applyGuestImport(
  db: D1Database,
  data: GuestImport,
  fingerprint: string,
  origin: string,
  actor: string,
) {
  const state = await snapshot(db),
    plan = await review(data, state);
  if (plan.fingerprint !== fingerprint)
    throw new DomainError(409, "importChanged");
  if (plan.conflicts.length) throw new DomainError(409, "importConflict");
  const statements: D1PreparedStatement[] = [],
    links: { householdId: string; code: string; url: string }[] = [],
    run = crypto.randomUUID();
  for (const h of data.households) {
    const change = plan.changes.find((c) => c.householdId === h.id)!;
    if (change.action === "unchanged") continue;
    const old = state.households.find((row) => row.id === h.id);
    // The CHECK constraint aborts the entire atomic batch if anything changed
    // after the review read, including a guest's concurrent RSVP or code rotation.
    statements.push(
      old
        ? db
            .prepare(
              `INSERT INTO guest_imports(id,household_id,checked,created_at) VALUES (?,?,CASE WHEN
          EXISTS(SELECT 1 FROM households WHERE id=? AND name=? AND email IS ? AND locale=? AND code_hash=? AND revision=?)
          AND (SELECT json_group_array(json_array(id,name,category)) FROM (SELECT id,name,category FROM guests WHERE household_id=? ORDER BY id))=?
          AND (SELECT json_group_array(event_id) FROM (SELECT event_id FROM invitations WHERE household_id=? ORDER BY event_id))=?
          THEN 1 ELSE 0 END,?)`,
            )
            .bind(
              `${run}:${h.id}`,
              h.id,
              h.id,
              old.name,
              old.email,
              old.locale,
              old.code_hash,
              old.revision,
              h.id,
              JSON.stringify(
                members(state, h.id).map((g) => [g.id, g.name, g.category]),
              ),
              h.id,
              JSON.stringify(events(state, h.id)),
              Date.now(),
            )
        : db
            .prepare(
              "INSERT INTO guest_imports(id,household_id,checked,created_at) VALUES (?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM households WHERE id=?) THEN 1 ELSE 0 END,?)",
            )
            .bind(`${run}:${h.id}`, h.id, h.id, Date.now()),
    );
    if (!old) {
      const code = randomToken();
      statements.push(
        db
          .prepare(
            "INSERT INTO households(id,name,email,locale,code_hash) VALUES (?,?,?,?,?)",
          )
          .bind(h.id, h.name, h.email, h.locale, await digest(code)),
      );
      links.push({
        householdId: h.id,
        code,
        url: `${origin}/${h.locale}/rsvp#invite=${code}`,
      });
    } else
      statements.push(
        db
          .prepare(
            "UPDATE households SET name=?,email=?,locale=?,revision=revision+1 WHERE id=?",
          )
          .bind(h.name, h.email, h.locale, h.id),
      );
    for (const guest of h.guests) {
      statements.push(
        state.guests.some((existing) => existing.id === guest.id)
          ? db
              .prepare(
                "UPDATE guests SET name=?,category=? WHERE id=? AND household_id=?",
              )
              .bind(guest.name, guest.category, guest.id, h.id)
          : db
              .prepare(
                "INSERT INTO guests(id,household_id,name,category) VALUES (?,?,?,?)",
              )
              .bind(guest.id, h.id, guest.name, guest.category),
      );
    }
    for (const eventId of h.eventIds)
      statements.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO invitations(household_id,event_id) VALUES (?,?)",
          )
          .bind(h.id, eventId),
      );
  }
  if (statements.length) {
    statements.push(
      db
        .prepare(
          "INSERT INTO audit(id,actor,action,created_at) VALUES (?,?,?,?)",
        )
        .bind(run, actor, "guests.imported", Date.now()),
    );
    try {
      await db.batch(statements);
    } catch (error) {
      if (
        String(error).includes("CHECK constraint failed") ||
        String(error).includes("UNIQUE constraint failed")
      )
        throw new DomainError(409, "importChanged");
      throw error;
    }
  }
  return { saved: true, summary: plan.summary, links };
}
