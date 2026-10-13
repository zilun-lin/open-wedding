// End-to-end verification against a running LOCAL dev server. Never targets a live site.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { writePrivate } from "./private-files.mjs";
const origin = process.env.SMOKE_ORIGIN || "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw new Error("Smoke tests are restricted to loopback hosts.");
const vars = readFileSync(".dev.vars", "utf8");
if (/^RESEND_API_KEY=.+/m.test(vars))
  throw new Error(
    "Remove local email credentials before running fixture smoke tests.",
  );
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
async function call(path, input, cookie = "") {
  const response = await fetch(origin + path, {
    method: input === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const result = await response.json();
  return { response, result };
}
const cookies = (response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
const english = await fetch(origin + "/en");
check(english.status === 200, "English page responds");
check((await english.text()).includes("Alex"), "English SSR has content");
const chinese = await fetch(origin + "/zh-Hans");
check(
  (await chinese.text()).includes('lang="zh-Hans"'),
  "Mandarin document language",
);
const setup = await call("/api/setup");
let credentials = existsSync(".wrangler/smoke-credentials.json")
  ? JSON.parse(readFileSync(".wrangler/smoke-credentials.json", "utf8"))
  : null;
if (!setup.result.configured) {
  credentials = {
    email: "host@open-wedding.test",
    password: randomBytes(24).toString("hex"),
  };
  const result = await call("/api/setup", {
    token: vars.match(/^SETUP_TOKEN=(.+)$/m)?.[1],
    name: "Example Host",
    ...credentials,
  });
  check(result.response.status === 200, "Initial host bootstrap");
  writeFileSync(
    ".wrangler/smoke-credentials.json",
    JSON.stringify(credentials),
    { mode: 0o600 },
  );
}
if (!credentials)
  throw new Error(
    "The local host belongs to another account. Use a fresh local test database.",
  );
const login = await call("/api/auth/sign-in/email", credentials);
check(login.response.status === 200, "Host login in Workers runtime");
const adminCookie = cookies(login.response);
const adminPage = await fetch(origin + "/admin", {
  headers: { Cookie: adminCookie },
});
check((await adminPage.text()).includes("Example Host"), "Host dashboard SSR");
check(
  (await call("/api/admin/config", {}, adminCookie)).response.status === 404,
  "Website editing API removed",
);
{
  const invite = await call(
    "/api/admin/households",
    {
      name: `Smoke ${randomUUID().slice(0, 8)}`,
      email: "guest@example.test",
      locale: "en",
      eventIds: ["ceremony", "reception"],
      guests: [
        { name: "Fixture Guest One", category: "adult" },
        { name: "Fixture Guest Two", category: "child" },
      ],
    },
    adminCookie,
  );
  check(invite.response.status === 200, "Household invitation creation");
  const unlock = await call("/api/invitation", { code: invite.result.code });
  check(unlock.response.status === 200, "Guest invitation redemption");
  const guestCookie = cookies(unlock.response);
  const guestPage = await fetch(origin + "/en/timeline", {
    headers: { Cookie: guestCookie },
  });
  check(
    !(await guestPage.text()).includes("PRIVATE-SMOKE-EVENT"),
    "Invite-only event excluded from guest SSR data",
  );
  const exported = await call("/api/admin/export", undefined, adminCookie);
  const guests = exported.result.guests.filter(
    (g) => g.household_id === invite.result.id,
  );
  check(guests.length === 2, "Private guest export");
  check(
    !JSON.stringify(exported.result).includes("code_hash"),
    "Export excludes invitation hashes",
  );
  const payload = {
    submissionId: randomUUID(),
    revision: 0,
    email: "guest@example.test",
    locale: "en",
    answers: guests.flatMap((g) =>
      ["ceremony", "reception"].map((eventId) => ({
        guestId: g.id,
        eventId,
        attending: true,
        meal: "vegetarian",
        dietary: "",
        accessibility: "",
        transport: "",
      })),
    ),
  };
  check(
    (await call("/api/rsvp", payload, guestCookie)).response.status === 200,
    "RSVP persists through Worker",
  );
  check(
    (await call("/api/rsvp", payload, guestCookie)).result.replay === true,
    "RSVP retry deduplicates",
  );
  check(
    (
      await call(
        "/api/rsvp",
        { ...payload, submissionId: randomUUID() },
        guestCookie,
      )
    ).response.status === 409,
    "Stale RSVP edit rejected",
  );
  check(
    (await call("/api/rsvp", {})).response.status === 401,
    "Anonymous RSVP denied",
  );
  const forbidden = await fetch(origin + "/api/admin/households", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
      Origin: "https://foreign.example",
    },
    body: "{}",
  });
  const forbiddenText = await forbidden.text();
  check(
    forbidden.status === 403,
    `Cross-origin writes denied (status ${forbidden.status}, ${forbiddenText.slice(0, 120)})`,
  );
  const tableName = `Fixture ${randomUUID().slice(0, 8)}`;
  check(
    (
      await call(
        "/api/admin/table",
        { eventId: "ceremony", name: tableName, capacity: 1 },
        adminCookie,
      )
    ).response.status === 200,
    "Table creation",
  );
  const tables = (await call("/api/admin/export", undefined, adminCookie))
      .result.tables,
    table = tables.find((t) => t.name === tableName);
  check(
    (
      await call(
        "/api/admin/seat",
        { guestId: guests[0].id, eventId: "ceremony", tableId: table.id },
        adminCookie,
      )
    ).response.status === 200,
    "Seat assignment",
  );
  check(
    (
      await call(
        "/api/admin/seat",
        { guestId: guests[1].id, eventId: "ceremony", tableId: table.id },
        adminCookie,
      )
    ).response.status === 409,
    "Table capacity enforced through API",
  );
  check(
    (
      await (
        await fetch(origin + "/en/seating", {
          headers: { Cookie: guestCookie },
        })
      ).text()
    ).includes(tableName),
    "Guest table visible after release",
  );
  const gift = await call(
    "/api/registry/reserve",
    { itemId: "ceramics" },
    guestCookie,
  );
  check(gift.response.status === 200, "Gift reservation");
  check(
    (
      await call(
        "/api/registry/update",
        { id: gift.result.id, status: "purchased" },
        guestCookie,
      )
    ).response.status === 200,
    "Gift purchase confirmation",
  );
  check(
    (
      await call(
        "/api/registry/update",
        { id: gift.result.id, status: "cancelled" },
        guestCookie,
      )
    ).response.status === 200,
    "Gift cancellation",
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cMZEAAAAASUVORK5CYII=",
    "base64",
  );
  const allocation = await call(
    "/api/media/start",
    { name: "fixture.png", type: "image/png", size: png.length },
    guestCookie,
  );
  check(allocation.response.status === 200, "Upload quota allocation");
  const path = `/api/media/${allocation.result.id}/file`,
    upload = await fetch(origin + path, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: guestCookie,
        "Content-Type": "image/png",
        "Content-Length": String(png.length),
      },
      body: png,
    });
  check(upload.status === 200, `Streaming R2 upload (status ${upload.status})`);
  check(
    (await fetch(origin + path, { headers: { Cookie: guestCookie } }))
      .status === 401,
    "Unapproved media stays private",
  );
  check(
    (await fetch(origin + path, { headers: { Cookie: adminCookie } }))
      .status === 200,
    "Host can review unapproved media",
  );
  check(
    (
      await call(
        "/api/admin/media",
        { id: allocation.result.id, action: "approve" },
        adminCookie,
      )
    ).response.status === 200,
    "Media approval",
  );
  const photo = await fetch(origin + path, {
    headers: { Cookie: guestCookie },
  });
  check(
    Buffer.from(await photo.arrayBuffer()).equals(png),
    "Approved original download matches upload",
  );
  const range = await fetch(origin + path, {
    headers: { Cookie: guestCookie, Range: "bytes=0-7" },
  });
  check(range.status === 206, "Partial media response supports video seeking");
  check((await range.arrayBuffer()).byteLength === 8, "Range response size");
  check(
    (
      await call(
        "/api/admin/media",
        { id: allocation.result.id, action: "delete" },
        adminCookie,
      )
    ).response.status === 200,
    "Media deletion",
  );
  check(
    (await fetch(origin + path, { headers: { Cookie: guestCookie } }))
      .status === 404,
    "Deleted object inaccessible",
  );
  const calendar = await fetch(origin + "/calendar/zh-Hans/ceremony.ics");
  check(
    calendar.status === 200 &&
      (await calendar.text()).includes("BEGIN:VCALENDAR"),
    "Localized calendar download",
  );
}
// Exercise the agent's actual commands against the compiled local Worker,
// without replacing an owner's existing session or retaining private fixtures.
const prefix = `private/smoke-${randomUUID()}`;
const files = {
  session: `${prefix}-session.json`,
  draft: `${prefix}-guests.json`,
  normalized: `${prefix}-normalized.json`,
  plan: `${prefix}-plan.json`,
  links: `${prefix}-links.json`,
  mail: `${prefix}-mail.json`,
  preview: `${prefix}-preview.json`,
  exported: `${prefix}-export.json`,
};
const command = (args) =>
  spawnSync(
    process.execPath,
    [
      "scripts/wedding.mjs",
      ...args,
      "--session",
      files.session,
      "--config",
      "examples/wedding.json",
    ],
    { encoding: "utf8", timeout: 30000 },
  );
const success = (result, message) => {
  check(result.status === 0, `${message}: ${result.stderr || result.stdout}`);
  return result;
};
try {
  success(
    spawnSync(
      process.execPath,
      [
        "scripts/wedding.mjs",
        "login",
        "--origin",
        origin,
        "--credentials-stdin",
        "--session",
        files.session,
      ],
      { input: JSON.stringify(credentials), encoding: "utf8", timeout: 30000 },
    ),
    "Agent login",
  );
  const source = JSON.parse(readFileSync("examples/guest-draft.json", "utf8"));
  source.sourceId = `fictional-${randomUUID()}`;
  source.households[0].email = "guest@example.test";
  writePrivate(files.draft, source);
  success(
    command([
      "guests",
      "prepare",
      "--file",
      files.draft,
      "--out",
      files.normalized,
    ]),
    "Agent preparation",
  );
  success(
    command([
      "guests",
      "plan",
      "--file",
      files.normalized,
      "--out",
      files.plan,
    ]),
    "Agent import preview",
  );
  check(
    JSON.parse(readFileSync(files.plan, "utf8")).summary.create === 1,
    "Preview detects a new household",
  );
  success(
    command([
      "guests",
      "apply",
      "--file",
      files.normalized,
      "--plan",
      files.plan,
      "--out",
      files.links,
    ]),
    "Agent import apply",
  );
  check(
    JSON.parse(readFileSync(files.links, "utf8")).links.length === 1,
    "Agent receives private invitation file",
  );
  success(
    command([
      "guests",
      "plan",
      "--file",
      files.normalized,
      "--out",
      files.plan,
    ]),
    "Agent reimport preview",
  );
  check(
    JSON.parse(readFileSync(files.plan, "utf8")).summary.unchanged === 1,
    "Agent reimport preserves stable records",
  );
  success(command(["export", "--out", files.exported]), "Agent guest export");
  check(
    !readFileSync(files.exported, "utf8").includes("code_hash"),
    "Agent export excludes invitation hashes",
  );
  writePrivate(
    files.mail,
    JSON.parse(readFileSync("examples/mail-draft.json", "utf8")),
  );
  success(
    command(["mail", "preview", "--file", files.mail, "--out", files.preview]),
    "Agent mail preview",
  );
  check(
    JSON.parse(readFileSync(files.preview, "utf8")).recipientCount > 0,
    "Mail preview includes actual outstanding replies",
  );
  check(
    command(["mail", "send", "--file", files.mail, "--plan", files.preview])
      .status !== 0,
    "Agent cannot send without explicit --send",
  );
  success(
    command([
      "mail",
      "send",
      "--file",
      files.mail,
      "--plan",
      files.preview,
      "--send",
    ]),
    "Local fixture campaign queue",
  );
  check(
    success(
      command([
        "mail",
        "send",
        "--file",
        files.mail,
        "--plan",
        files.preview,
        "--send",
      ]),
      "Agent campaign retry",
    ).stdout.includes("already queued"),
    "Agent campaign retry deduplicates",
  );
} finally {
  for (const file of [...Object.values(files), `${files.preview}.html`])
    if (existsSync(file)) unlinkSync(file);
}
console.log(
  `${checks} local Worker smoke checks passed. No external email was sent.`,
);
