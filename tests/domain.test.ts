import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { parseConfig } from "../app/config/schema";
import defaults from "../content/wedding.json";
import { getConfig, visibleConfig } from "../app/platform/config.server";
import { digest, sameOrigin } from "../app/platform/security.server";
import { saveRsvp } from "../app/domain/rsvp.server";
import { parseGuestImport, type GuestImport } from "../app/domain/guest-import";
import {
  planGuestImport,
  applyGuestImport,
} from "../app/domain/guest-import.server";
import { mailDraftSchema } from "../app/domain/mail";
import { planMail, queueMail } from "../app/domain/mail.server";
import { reserveGift } from "../app/domain/registry.server";
import { startMedia, validSignature } from "../app/domain/media.server";
import { deliverOutbox, outboxStatement } from "../app/platform/email.server";
import { handleApi } from "../app/platform/api.server";
import { calendarFile } from "../app/domain/calendar.server";
import { en, tr } from "../app/i18n";
import type { AppEnv } from "../app/platform/context";
let mf: Miniflare, env: AppEnv;
const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil: (promise: Promise<unknown>) => pending.push(promise),
} as unknown as ExecutionContext;
const household = "701a1d3a-6844-4b22-8b13-e5c240edbc97",
  other = "0b1d05ac-8356-4b41-9d27-b7d3a70c3bde",
  guest = "49477725-de8c-4ed1-9c90-d2e5eb5ba5e6",
  foreign = "736d3acb-1c21-47a0-9d44-9fedb332d852";
const config = () => parseConfig(structuredClone(defaults));
const payload = () => ({
  submissionId: crypto.randomUUID(),
  revision: 0,
  email: "guest@example.com",
  locale: "en",
  answers: config().events.map((event) => ({
    guestId: guest,
    eventId: event.id,
    attending: true,
    meal: "vegetarian",
    dietary: "",
    accessibility: "",
    transport: "",
  })),
});
const request = (
  path: string,
  input?: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`http://localhost${path}`, {
    method: input === undefined ? "GET" : "POST",
    headers: {
      Origin: "http://localhost",
      "Content-Type": "application/json",
      ...headers,
    },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "test",
          modules: true,
          script: "export default { fetch(){return new Response('test')} }",
          compatibilityDate: "2026-10-06",
          d1Databases: { DB: "test-db" },
          r2Buckets: { MEDIA: "test-media" },
        },
      ],
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const file of readdirSync("migrations").sort())
    await db.exec(readFileSync(`migrations/${file}`, "utf8"));
  env = {
    DB: db as unknown as D1Database,
    MEDIA: (await mf.getR2Bucket("MEDIA")) as unknown as R2Bucket,
    EMAIL_QUEUE: { send: async () => {} } as unknown as Queue<{ id: string }>,
    AUTH_SECRET: "a-test-secret-with-more-than-32-characters",
    SETUP_TOKEN: "secret-bootstrap-token",
  };
});
afterAll(async () => {
  await mf?.dispose();
});
afterEach(async () => {
  await Promise.allSettled(pending.splice(0));
});
beforeEach(async () => {
  await env.DB.batch(
    [
      "guest_imports",
      "email_campaigns",
      "seats",
      "seating_tables",
      "reservations",
      "media",
      "outbox",
      "submissions",
      "rsvps",
      "invitations",
      "guest_sessions",
      "guests",
      "households",
      "settings",
      "limits",
      "session",
      "account",
      "user",
      "verification",
      "rate_limit",
      "audit",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO households(id,name,locale,code_hash) VALUES (?,'Test household','en',?)",
    ).bind(household, await digest("test-invitation-code")),
    env.DB.prepare(
      "INSERT INTO households(id,name,locale,code_hash) VALUES (?,'Other household','en',?)",
    ).bind(other, await digest("other-invitation-code")),
    env.DB.prepare(
      "INSERT INTO guests(id,household_id,name,category) VALUES (?,?,?,'adult')",
    ).bind(guest, household, "Test Guest"),
    env.DB.prepare(
      "INSERT INTO guests(id,household_id,name,category) VALUES (?,?,?,'adult')",
    ).bind(foreign, other, "Other Guest"),
    ...config().events.map((e) =>
      env.DB.prepare(
        "INSERT INTO invitations(household_id,event_id) VALUES (?,?)",
      ).bind(household, e.id),
    ),
  ]);
});
describe("configuration and language", () => {
  it("ignores legacy database content overrides", async () => {
    await env.DB.prepare(
      "INSERT INTO settings(key,value) VALUES ('wedding','not JSON')",
    ).run();
    expect(getConfig()).toEqual(config());
  });
  it("validates the reusable bilingual example", () => {
    expect(config().partners[0].name.en).toBe("Alex");
  });
  it("rejects missing translations and unsafe URLs", () => {
    const c = config();
    delete (c.welcome as Record<string, string>)["zh-Hans"];
    expect(() => parseConfig(c)).toThrow();
    c.venue.mapUrl = "javascript:alert(1)";
    expect(() => parseConfig(c)).toThrow();
  });
  it("rejects empty localized records", () => {
    const c = structuredClone(defaults);
    c.welcome = {} as typeof c.welcome;
    expect(() => parseConfig(c)).toThrow();
  });
  it("compares actual event times across offsets", () => {
    const c = structuredClone(defaults);
    c.events[0].startsAt = "2027-09-18T15:00:00+02:00";
    c.events[0].endsAt = "2027-09-18T14:30:00+00:00";
    expect(() => parseConfig(c)).not.toThrow();
  });
  it("keeps invite-only event contents out of public data", () => {
    const c = config();
    c.events[0].visibility = "invited";
    expect(
      visibleConfig(c, []).events.some((e) => e.id === c.events[0].id),
    ).toBe(false);
  });
  it("has Mandarin strings for every English interface key", () => {
    for (const key of Object.keys(en)) expect(tr("zh-Hans", key)).not.toBe(key);
  });
  it("escapes and folds calendar text without event injection", () => {
    const c = config();
    c.events[0].description.en = "Hello\nEND:VEVENT\nBEGIN:VEVENT";
    const ics = calendarFile(c.events[0], "en");
    expect(ics.match(/\r\nBEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("DTSTART:20270918T140000Z");
  });
});

describe("reviewed guest imports", () => {
  const existing = (): GuestImport => ({
    schemaVersion: 1,
    households: [
      {
        id: household,
        name: "Test household",
        email: null,
        locale: "en",
        eventIds: config().events.map((e) => e.id),
        guests: [{ id: guest, name: "Test Guest", category: "adult" }],
      },
    ],
  });
  const fresh = (): GuestImport => ({
    schemaVersion: 1,
    households: [
      {
        id: crypto.randomUUID(),
        name: "New household",
        email: "new@example.com",
        locale: "en",
        eventIds: ["ceremony"],
        guests: [
          { id: crypto.randomUUID(), name: "New Guest", category: "adult" },
        ],
      },
    ],
  });
  it("rejects duplicate keys, unknown events and disabled languages", () => {
    const input = existing();
    input.households.push(structuredClone(input.households[0]));
    expect(() => parseGuestImport(input, config())).toThrow();
    const unknown = fresh();
    unknown.households[0].eventIds = ["unknown"];
    expect(() => parseGuestImport(unknown, config())).toThrow();
    const c = config();
    c.locales = ["zh-Hans"];
    expect(() => parseGuestImport(fresh(), c)).toThrow();
  });
  it("previews without creating guests or sending invitations", async () => {
    const plan = await planGuestImport(env.DB, fresh());
    expect(plan.summary.create).toBe(1);
    expect(
      (await env.DB.prepare("SELECT * FROM households").all()).results,
    ).toHaveLength(2);
    expect(
      (await env.DB.prepare("SELECT * FROM outbox").all()).results,
    ).toHaveLength(0);
  });
  it("creates stable records once and returns private links only on creation", async () => {
    const data = fresh(),
      plan = await planGuestImport(env.DB, data);
    const result = await applyGuestImport(
      env.DB,
      data,
      plan.fingerprint,
      "http://localhost",
      "host",
    );
    expect(result.links).toHaveLength(1);
    const stored = await env.DB.prepare(
      "SELECT code_hash FROM households WHERE id=?",
    )
      .bind(data.households[0].id)
      .first<{ code_hash: string }>();
    expect(stored?.code_hash).toBe(await digest(result.links[0].code));
    const next = await planGuestImport(env.DB, data);
    expect(next.summary.unchanged).toBe(1);
    expect(
      (
        await applyGuestImport(
          env.DB,
          data,
          next.fingerprint,
          "http://localhost",
          "host",
        )
      ).links,
    ).toEqual([]);
    expect(
      (await env.DB.prepare("SELECT * FROM outbox").all()).results,
    ).toHaveLength(0);
  });
  it("updates reviewed metadata while retaining answers and invitation codes", async () => {
    await saveRsvp(env, config(), household, payload(), "http://localhost");
    const data = existing();
    data.households[0].name = "Updated household";
    data.households[0].email = "updated@example.com";
    data.households[0].guests[0].name = "Updated Guest";
    const plan = await planGuestImport(env.DB, data);
    expect(plan.changes[0].fields).toContain("email");
    await applyGuestImport(
      env.DB,
      data,
      plan.fingerprint,
      "http://localhost",
      "host",
    );
    expect(
      await env.DB.prepare(
        "SELECT name,email,revision,code_hash FROM households WHERE id=?",
      )
        .bind(household)
        .first(),
    ).toMatchObject({
      name: "Updated household",
      email: "updated@example.com",
      revision: 2,
      code_hash: await digest("test-invitation-code"),
    });
    expect(
      (await env.DB.prepare("SELECT * FROM rsvps").all()).results,
    ).toHaveLength(2);
    const stale = payload();
    stale.revision = 1;
    await expect(
      saveRsvp(env, config(), household, stale, "http://localhost"),
    ).rejects.toThrow("rsvpConflict");
  });
  it("rejects changed inputs and stale backend previews", async () => {
    const data = fresh(),
      plan = await planGuestImport(env.DB, data);
    data.households[0].email = "changed@example.com";
    await expect(
      applyGuestImport(
        env.DB,
        data,
        plan.fingerprint,
        "http://localhost",
        "host",
      ),
    ).rejects.toThrow("importChanged");
    const current = existing(),
      review = await planGuestImport(env.DB, current);
    await env.DB.prepare(
      "UPDATE households SET email='latest@example.com' WHERE id=?",
    )
      .bind(household)
      .run();
    await expect(
      applyGuestImport(
        env.DB,
        current,
        review.fingerprint,
        "http://localhost",
        "host",
      ),
    ).rejects.toThrow("importChanged");
  });
  it("allows an unrelated household to reply while an import is reviewed", async () => {
    const data = fresh(),
      plan = await planGuestImport(env.DB, data);
    await env.DB.prepare("UPDATE households SET revision=revision+1 WHERE id=?")
      .bind(other)
      .run();
    expect(
      (
        await applyGuestImport(
          env.DB,
          data,
          plan.fingerprint,
          "http://localhost",
          "host",
        )
      ).summary.create,
    ).toBe(1);
  });
  it("rejects removals and moving a guest between households", async () => {
    const data = existing();
    data.households[0].eventIds = [];
    const plan = await planGuestImport(env.DB, data);
    expect(plan.conflicts[0].reason).toBe("invitationRemovalRequiresReview");
    await expect(
      applyGuestImport(
        env.DB,
        data,
        plan.fingerprint,
        "http://localhost",
        "host",
      ),
    ).rejects.toThrow("importConflict");
    const move = fresh();
    move.households[0].guests[0].id = guest;
    expect((await planGuestImport(env.DB, move)).conflicts[0].reason).toBe(
      "guestBelongsToAnotherHousehold",
    );
    const remove = existing();
    remove.households[0].guests[0].id = crypto.randomUUID();
    expect(
      (await planGuestImport(env.DB, remove)).conflicts.some(
        (c) => c.reason === "guestRemovalRequiresReview",
      ),
    ).toBe(true);
  });
  it("rolls back an entire import if a guest reply races the atomic write", async () => {
    const added = fresh(),
      changed = existing();
    changed.households[0].name = "Proposed name";
    const data = {
        schemaVersion: 1 as const,
        households: [...added.households, ...changed.households],
      },
      plan = await planGuestImport(env.DB, data);
    const racing = {
      prepare: (query: string) => env.DB.prepare(query),
      batch: async (statements: D1PreparedStatement[]) => {
        await env.DB.prepare(
          "UPDATE households SET revision=revision+1 WHERE id=?",
        )
          .bind(household)
          .run();
        return env.DB.batch(statements);
      },
    } as unknown as D1Database;
    await expect(
      applyGuestImport(
        racing,
        data,
        plan.fingerprint,
        "http://localhost",
        "host",
      ),
    ).rejects.toThrow("importChanged");
    expect(
      await env.DB.prepare("SELECT name,revision FROM households WHERE id=?")
        .bind(household)
        .first(),
    ).toEqual({ name: "Test household", revision: 1 });
    expect(
      await env.DB.prepare("SELECT id FROM households WHERE id=?")
        .bind(added.households[0].id)
        .first(),
    ).toBeNull();
    expect(
      (await env.DB.prepare("SELECT * FROM guest_imports").all()).results,
    ).toHaveLength(0);
  });
  it("rolls back if another household claims a new guest ID during the import", async () => {
    const data = fresh(),
      plan = await planGuestImport(env.DB, data),
      incoming = data.households[0];
    const racing = {
      prepare: (query: string) => env.DB.prepare(query),
      batch: async (statements: D1PreparedStatement[]) => {
        await env.DB.prepare(
          "INSERT INTO guests(id,household_id,name,category) VALUES (?,?,'Concurrent Guest','adult')",
        )
          .bind(incoming.guests[0].id, other)
          .run();
        return env.DB.batch(statements);
      },
    } as unknown as D1Database;
    await expect(
      applyGuestImport(
        racing,
        data,
        plan.fingerprint,
        "http://localhost",
        "host",
      ),
    ).rejects.toThrow("importChanged");
    expect(
      await env.DB.prepare("SELECT id FROM households WHERE id=?")
        .bind(incoming.id)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT household_id FROM guests WHERE id=?")
        .bind(incoming.guests[0].id)
        .first(),
    ).toEqual({ household_id: other });
  });
});

describe("reviewed email campaigns", () => {
  const draft = () =>
    mailDraftSchema.parse({
      subject: "Please RSVP",
      message: "Use your private invitation.",
      locale: "en",
      eventId: "ceremony",
      audience: "awaiting-rsvp",
    });
  it("selects actual missing replies and attending guests without queueing", async () => {
    await env.DB.prepare(
      "UPDATE households SET email='guest@example.com' WHERE id=?",
    )
      .bind(household)
      .run();
    const plan = await planMail(env.DB, draft(), config(), "http://localhost");
    expect(plan.recipients).toEqual(["guest@example.com"]);
    expect(
      (await env.DB.prepare("SELECT * FROM outbox").all()).results,
    ).toHaveLength(0);
    await saveRsvp(env, config(), household, payload(), "http://localhost");
    expect(
      (await planMail(env.DB, draft(), config(), "http://localhost"))
        .recipients,
    ).toEqual([]);
    expect(
      (
        await planMail(
          env.DB,
          { ...draft(), audience: "attending" },
          config(),
          "http://localhost",
        )
      ).recipients,
    ).toEqual(["guest@example.com"]);
  });
  it("respects language, invitations and missing contacts", async () => {
    const noEmail = await planMail(
      env.DB,
      draft(),
      config(),
      "http://localhost",
    );
    expect(noEmail.missingEmailHouseholds).toBe(1);
    await env.DB.prepare(
      "UPDATE households SET email='wrong-language@example.com',locale='zh-Hans' WHERE id=?",
    )
      .bind(household)
      .run();
    await env.DB.prepare(
      "UPDATE households SET email='uninvited@example.com' WHERE id=?",
    )
      .bind(other)
      .run();
    expect(
      (await planMail(env.DB, draft(), config(), "http://localhost"))
        .recipients,
    ).toEqual([]);
    expect(
      (
        await planMail(
          env.DB,
          { ...draft(), locale: "zh-Hans" },
          config(),
          "http://localhost",
        )
      ).recipients,
    ).toEqual(["wrong-language@example.com"]);
    await expect(
      planMail(
        env.DB,
        { ...draft(), eventId: "unknown" },
        config(),
        "http://localhost",
      ),
    ).rejects.toThrow("invalidInvitation");
  });
  it("queues a campaign exactly once even for concurrent retries", async () => {
    await env.DB.prepare(
      "UPDATE households SET email='guest@example.com' WHERE id=?",
    )
      .bind(household)
      .run();
    const plan = await planMail(env.DB, draft(), config(), "http://localhost"),
      id = crypto.randomUUID();
    await Promise.all([
      queueMail(env.DB, plan, id, "host"),
      queueMail(env.DB, plan, id, "host"),
    ]);
    expect(
      (await env.DB.prepare("SELECT * FROM outbox").all()).results,
    ).toHaveLength(1);
    expect((await queueMail(env.DB, plan, id, "host")).replay).toBe(true);
    const changed = await planMail(
      env.DB,
      { ...draft(), subject: "Changed" },
      config(),
      "http://localhost",
    );
    await expect(queueMail(env.DB, changed, id, "host")).rejects.toThrow(
      "campaignChanged",
    );
  });
  it("rejects stale previews and safely retries a sent campaign after its audience changes", async () => {
    const setup = await handleApi(
      request("/api/setup", {
        token: env.SETUP_TOKEN,
        name: "Host",
        email: "host@example.com",
        password: "long-test-password",
      }),
      env,
      ctx,
    );
    expect(setup.status).toBe(200);
    const login = await handleApi(
      request("/api/auth/sign-in/email", {
        email: "host@example.com",
        password: "long-test-password",
      }),
      env,
      ctx,
    );
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const planned = await handleApi(
      request("/api/admin/mail/plan", draft(), { Cookie: cookie }),
      env,
      ctx,
    );
    const preview = (await planned.json()) as { fingerprint: string };
    await env.DB.prepare(
      "UPDATE households SET email='new@example.com' WHERE id=?",
    )
      .bind(household)
      .run();
    const sent = await handleApi(
      request(
        "/api/admin/mail/send",
        {
          draft: draft(),
          campaignId: crypto.randomUUID(),
          fingerprint: preview.fingerprint,
          confirm: true,
        },
        { Cookie: cookie },
      ),
      env,
      ctx,
    );
    expect(sent.status).toBe(409);
    expect(
      (await env.DB.prepare("SELECT * FROM outbox").all()).results,
    ).toHaveLength(0);
    const updated = await planMail(
      env.DB,
      draft(),
      config(),
      "http://localhost",
    );
    const campaign = {
      draft: draft(),
      campaignId: crypto.randomUUID(),
      fingerprint: updated.fingerprint,
      confirm: true,
    };
    const queued = await handleApi(
      request("/api/admin/mail/send", campaign, { Cookie: cookie }),
      env,
      ctx,
    );
    expect(await queued.json()).toMatchObject({ queued: 1, replay: false });
    await env.DB.prepare("UPDATE households SET locale='zh-Hans' WHERE id=?")
      .bind(household)
      .run();
    const retry = await handleApi(
      request("/api/admin/mail/send", campaign, { Cookie: cookie }),
      env,
      ctx,
    );
    expect(await retry.json()).toMatchObject({
      queued: 0,
      previouslyQueued: 1,
      replay: true,
    });
    expect(
      (await env.DB.prepare("SELECT * FROM outbox").all()).results,
    ).toHaveLength(1);
    expect(
      (await handleApi(request("/api/admin/guests/plan", {}), env, ctx)).status,
    ).toBe(401);
    expect(
      (
        await handleApi(
          request("/api/admin/config", {}, { Cookie: cookie }),
          env,
          ctx,
        )
      ).status,
    ).toBe(404);
  });
});
describe("RSVP", () => {
  it("atomically saves answers and the email outbox", async () => {
    const p = payload();
    await saveRsvp(env, config(), household, p, "http://localhost");
    expect(
      (await env.DB.prepare("SELECT * FROM rsvps").all()).results,
    ).toHaveLength(2);
    expect(
      (await env.DB.prepare("SELECT * FROM outbox").all()).results,
    ).toHaveLength(1);
  });
  it("makes a repeated submission idempotent", async () => {
    const p = payload();
    await saveRsvp(env, config(), household, p, "http://localhost");
    expect(
      (await saveRsvp(env, config(), household, p, "http://localhost")).replay,
    ).toBe(true);
    expect(
      (await env.DB.prepare("SELECT * FROM outbox").all()).results,
    ).toHaveLength(1);
  });
  it("rejects another household's guest", async () => {
    const p = payload();
    p.answers[0].guestId = foreign;
    await expect(
      saveRsvp(env, config(), household, p, "http://localhost"),
    ).rejects.toThrow("invalidInvitation");
  });
  it("rejects uninvited events and duplicate answers", async () => {
    const p = payload();
    p.answers[0].eventId = "private-dinner";
    await expect(
      saveRsvp(env, config(), household, p, "http://localhost"),
    ).rejects.toThrow("invalidInvitation");
  });
  it("rejects stale edits without changing answers", async () => {
    await saveRsvp(env, config(), household, payload(), "http://localhost");
    const p = payload();
    p.answers[0].attending = false;
    await expect(
      saveRsvp(env, config(), household, p, "http://localhost"),
    ).rejects.toThrow("rsvpConflict");
    expect(
      (
        await env.DB.prepare(
          "SELECT attending FROM rsvps WHERE guest_id=? AND event_id='ceremony'",
        )
          .bind(guest)
          .first<{ attending: number }>()
      )?.attending,
    ).toBe(1);
  });
  it("enforces the server deadline", async () => {
    const c = config();
    c.rsvpDeadline = "2000-01-01T00:00:00Z";
    await expect(
      saveRsvp(env, c, household, payload(), "http://localhost"),
    ).rejects.toThrow("rsvpClosed");
  });
  it("enforces disabled feature flags on the server", async () => {
    const c = config();
    c.features.rsvp = false;
    await expect(
      saveRsvp(env, c, household, payload(), "http://localhost"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
describe("seating and gifts", () => {
  it("prevents overfilling a table atomically", async () => {
    await saveRsvp(env, config(), household, payload(), "http://localhost");
    const table = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO seating_tables(id,event_id,name,capacity) VALUES (?,'ceremony','One',1)",
      ).bind(table),
      env.DB.prepare(
        "INSERT INTO rsvps(guest_id,event_id,attending) VALUES (?,'ceremony',1)",
      ).bind(foreign),
      env.DB.prepare(
        "INSERT INTO seats(guest_id,event_id,table_id) VALUES (?,'ceremony',?)",
      ).bind(guest, table),
    ]);
    await expect(
      env.DB.prepare(
        "INSERT INTO seats(guest_id,event_id,table_id) VALUES (?,'ceremony',?)",
      )
        .bind(foreign, table)
        .run(),
    ).rejects.toThrow("tableFull");
  });
  it("requires attendance at the table's event", async () => {
    const table = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO seating_tables(id,event_id,name,capacity) VALUES (?,'ceremony','One',8)",
    )
      .bind(table)
      .run();
    await expect(
      env.DB.prepare(
        "INSERT INTO seats(guest_id,event_id,table_id) VALUES (?,'ceremony',?)",
      )
        .bind(foreign, table)
        .run(),
    ).rejects.toThrow("seatRequiresAttendance");
  });
  it("allows only one last-item reservation in a race", async () => {
    const c = config();
    c.registry[1].quantity = 1;
    const results = await Promise.allSettled([
      reserveGift(env.DB, c, household, "ceramics"),
      reserveGift(env.DB, c, other, "ceramics"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("releases expired reservations", async () => {
    const c = config();
    c.registry[1].quantity = 1;
    await reserveGift(env.DB, c, household, "ceramics");
    await env.DB.prepare("UPDATE reservations SET expires_at=0").run();
    await expect(
      reserveGift(env.DB, c, other, "ceramics"),
    ).resolves.toHaveProperty("id");
  });
});
describe("media and email", () => {
  it("enforces upload size and household quotas", async () => {
    const c = config();
    c.media.releaseAt = "2000-01-01T00:00:00Z";
    c.media.maxFilesPerHousehold = 1;
    await startMedia(env, c, household, {
      name: "image.jpg",
      type: "image/jpeg",
      size: 100,
    });
    await expect(
      startMedia(env, c, household, {
        name: "next.jpg",
        type: "image/jpeg",
        size: 100,
      }),
    ).rejects.toThrow("uploadQuotaReached");
    await expect(
      startMedia(env, c, other, {
        name: "big.jpg",
        type: "image/jpeg",
        size: 100 * 1024 * 1024,
      }),
    ).rejects.toThrow("fileTooLarge");
  });
  it("rejects active formats and mismatched file signatures", async () => {
    const c = config();
    c.media.releaseAt = "2000-01-01T00:00:00Z";
    await expect(
      startMedia(env, c, household, {
        name: "x.svg",
        type: "image/svg+xml",
        size: 100,
      }),
    ).rejects.toThrow();
    expect(
      validSignature("image/jpeg", new TextEncoder().encode("<script>x")),
    ).toBe(false);
    expect(
      validSignature("image/jpeg", new Uint8Array([255, 216, 255, 0])),
    ).toBe(true);
  });
  it("deduplicates queued email delivery", async () => {
    const id = crypto.randomUUID();
    await outboxStatement(
      env.DB,
      id,
      "test@example.com",
      "Subject",
      "<p>Hello</p>",
      "Hello",
    ).run();
    let sends = 0;
    const provider = {
      send: async () => {
        sends++;
      },
    };
    await Promise.all([
      deliverOutbox(env, id, provider),
      deliverOutbox(env, id, provider),
    ]);
    expect(sends).toBe(1);
    await deliverOutbox(env, id, provider);
    expect(sends).toBe(1);
  });
  it("retains failed mail for retry", async () => {
    const id = crypto.randomUUID();
    await outboxStatement(
      env.DB,
      id,
      "test@example.com",
      "Subject",
      "<p>Hello</p>",
      "Hello",
    ).run();
    await deliverOutbox(env, id, {
      send: async () => {
        throw new Error("offline");
      },
    });
    expect(
      await env.DB.prepare("SELECT status,attempts FROM outbox WHERE id=?")
        .bind(id)
        .first(),
    ).toMatchObject({ status: "pending", attempts: 1 });
  });
});
describe("HTTP access boundaries", () => {
  it("serves approved originals as 200 and requested byte ranges as 206", async () => {
    const c = config();
    c.media.releaseAt = "2000-01-01T00:00:00Z";
    const id = crypto.randomUUID(),
      token = crypto.randomUUID(),
      key = `test/${id}`,
      bytes = new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8,
      ]);
    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: "image/png" },
    });
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO guest_sessions(token_hash,household_id,expires_at) VALUES (?,?,?)",
      ).bind(await digest(token), household, Date.now() + 60000),
      env.DB.prepare(
        "INSERT INTO media(id,household_id,object_key,name,content_type,bytes,status,created_at) VALUES (?,?,?,'test.png','image/png',?,'approved',?)",
      ).bind(id, household, key, bytes.length, Date.now()),
    ]);
    const full = await handleApi(
      request(`/api/media/${id}/file`, undefined, {
        Cookie: `ow_guest=${token}`,
      }),
      env,
      ctx,
      c,
    );
    expect(full.status).toBe(200);
    expect(full.headers.has("Content-Range")).toBe(false);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
    const partial = await handleApi(
      request(`/api/media/${id}/file`, undefined, {
        Cookie: `ow_guest=${token}`,
        Range: "bytes=0-7",
      }),
      env,
      ctx,
      c,
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Content-Range")).toBe("bytes 0-7/16");
    expect((await partial.arrayBuffer()).byteLength).toBe(8);
  });
  it("rejects cross-origin writes", () => {
    expect(() =>
      sameOrigin(
        new Request("http://localhost/api/rsvp", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        }),
        env,
      ),
    ).toThrow("invalidOrigin");
  });
  it("requires a guest session for RSVP and media", async () => {
    expect((await handleApi(request("/api/rsvp", {}), env, ctx)).status).toBe(
      401,
    );
    expect(
      (await handleApi(request("/api/media/start", {}), env, ctx)).status,
    ).toBe(401);
  });
  it("redeems a hashed invitation into an HttpOnly session", async () => {
    const response = await handleApi(
      request("/api/invitation", { code: "test-invitation-code" }),
      env,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).not.toContain(
      "test-invitation-code",
    );
  });
  it("requires admin authentication for exports", async () => {
    expect(
      (await handleApi(request("/api/admin/export"), env, ctx)).status,
    ).toBe(401);
  });
  it("guards bootstrap with a secret and disables public signup", async () => {
    expect(
      (
        await handleApi(
          request("/api/setup", {
            token: "wrong",
            name: "Host",
            email: "host@example.com",
            password: "long-test-password",
          }),
          env,
          ctx,
        )
      ).status,
    ).toBe(403);
    const signup = await handleApi(
      request("/api/auth/sign-up/email", {
        name: "Stranger",
        email: "stranger@example.com",
        password: "long-test-password",
      }),
      env,
      ctx,
    );
    expect(signup.status).not.toBe(200);
  });
  it("creates exactly one initial admin and permits sign-in", async () => {
    const input = {
      token: env.SETUP_TOKEN,
      name: "Host",
      email: "host@example.com",
      password: "long-test-password",
    };
    const setup = await handleApi(request("/api/setup", input), env, ctx);
    expect(await setup.json()).toEqual({ saved: true });
    expect(
      (await env.DB.prepare("SELECT role FROM user").first<{ role: string }>())
        ?.role,
    ).toBe("admin");
    expect(
      (await handleApi(request("/api/setup", input), env, ctx)).status,
    ).toBe(409);
    const login = await handleApi(
      request("/api/auth/sign-in/email", {
        email: input.email,
        password: input.password,
      }),
      env,
      ctx,
    );
    expect(login.status).toBe(200);
    expect(login.headers.get("Set-Cookie")).toContain(
      "better-auth.session_token",
    );
  });
});
