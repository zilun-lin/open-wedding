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
import { visibleConfig } from "../app/platform/config.server";
import { digest, sameOrigin } from "../app/platform/security.server";
import { saveRsvp } from "../app/domain/rsvp.server";
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
        "INSERT INTO settings(key,value) VALUES ('wedding',?)",
      ).bind(JSON.stringify(c)),
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
