import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";
import { parseConfig } from "../app/config/schema.ts";
import { parseGuestImport } from "../app/domain/guest-import.ts";
import { mailDraftSchema } from "../app/domain/mail.ts";
import { prepareGuestDraft } from "./guest-draft.mjs";
import {
  privatePath,
  readJson,
  readPrivate,
  writePrivate,
} from "./private-files.mjs";

const help = `Open Wedding agent tools (run from your checkout)
  npm run wedding -- intake
  npm run wedding -- login --origin https://your-wedding.example
  npm run wedding -- guests prepare --file private/guest-draft.json
  npm run wedding -- guests check --file private/guest-import.json
  npm run wedding -- guests plan --file private/guest-import.json
  npm run wedding -- guests apply --file private/guest-import.json --plan private/guest-plan.json
  npm run wedding -- export
  npm run wedding -- mail preview --file private/mail-draft.json
  npm run wedding -- mail send --file private/mail-draft.json --plan private/mail-preview.json --send

Outputs stay in ignored private/ with owner-only permissions. Planning never sends email.
Read docs/agent-workflow.md before importing real guests or sending messages.
Login prompts hide the password; agents can use --credentials-stdin with JSON on stdin.
Use --out private/name.json to choose an output. Guest preparation refuses replacement
unless --overwrite is specified; keep source IDs and record keys stable between exports.`;

function origin(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  )
    throw new Error(
      "Use an HTTPS origin, or HTTP on loopback for local development.",
    );
  return url.origin;
}

async function api(path, data, connection) {
  const response = await fetch(connection.origin + path, {
    method: data === undefined ? "GET" : "POST",
    redirect: "error",
    headers: {
      Origin: connection.origin,
      "Content-Type": "application/json",
      Cookie: connection.cookie || "",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      `Request rejected (${response.status}): ${result.error || "authenticationFailed"}. ${response.status === 401 ? "Run wedding login again." : "Review the plan and site configuration."}`,
    );
  return { response, result };
}

function connection(file = "private/session.json") {
  const saved = readPrivate(file);
  if (typeof saved.cookie !== "string" || !saved.cookie)
    throw new Error("Run wedding login first.");
  return { origin: origin(saved.origin), cookie: saved.cookie };
}

async function credentials(fromStdin) {
  if (fromStdin) return JSON.parse(readFileSync(0, "utf8"));
  if (!process.stdin.isTTY)
    throw new Error(
      "Interactive login requires a terminal. Agents may pass credentials JSON on stdin with --credentials-stdin.",
    );
  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!hidden) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const email = (await rl.question("Host email: ")).trim();
    process.stdout.write("Host password: ");
    hidden = true;
    const password = await rl.question("");
    return { email, password };
  } finally {
    hidden = false;
    process.stdout.write("\n");
    rl.close();
  }
}

async function main() {
  const {
    positionals: [command, action],
    values,
  } = parseArgs({
    allowPositionals: true,
    options: {
      file: { type: "string" },
      plan: { type: "string" },
      out: { type: "string" },
      origin: { type: "string" },
      session: { type: "string" },
      send: { type: "boolean", default: false },
      overwrite: { type: "boolean", default: false },
      "credentials-stdin": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (!command || values.help) return console.log(help);
  if (command === "intake") {
    const files = {
      "private/sources.json": {
        schemaVersion: 1,
        sources: [],
        languages: ["en", "zh-Hans"],
      },
      "private/decisions.md":
        "# Wedding decisions\n\n## Confirmed facts\n\n## Conflicting or missing information\n\n## Public versus invitation-only information\n\n## Guest grouping and contact choices\n\n## Communication priorities and reviewed drafts\n\n## Source revisions and last sync\n",
    };
    for (const [file, data] of Object.entries(files))
      if (!existsSync(privatePath(file)))
        writePrivate(file, data, { overwrite: false });
    console.log(
      "Private intake workspace ready. Follow docs/agent-workflow.md; no sources were fetched or imported.",
    );
    return;
  }
  if (command === "login") {
    if (!values.origin) throw new Error("Login needs --origin.");
    const target = origin(values.origin),
      input = await credentials(values["credentials-stdin"]);
    if (typeof input.email !== "string" || typeof input.password !== "string")
      throw new Error("Provide email and password strings on stdin.");
    const { response } = await api(
      "/api/auth/sign-in/email",
      { email: input.email, password: input.password },
      { origin: target },
    );
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    if (!cookie)
      throw new Error(
        "No session returned. Use the same origin configured for the site.",
      );
    writePrivate(values.session || "private/session.json", {
      schemaVersion: 1,
      origin: target,
      cookie,
      createdAt: new Date().toISOString(),
    });
    console.log("Host session saved privately. Your password was not stored.");
    return;
  }
  const config = parseConfig(readJson("content/wedding.json"));
  if (command === "guests") {
    const file =
      values.file ||
      (action === "prepare"
        ? "private/guest-draft.json"
        : "private/guest-import.json");
    const input =
      action === "prepare"
        ? prepareGuestDraft(readJson(file), config)
        : parseGuestImport(readJson(file), config);
    if (action === "prepare") {
      const out = values.out || "private/guest-import.json";
      writePrivate(out, input, { overwrite: values.overwrite });
      console.log(
        `Prepared ${input.households.length} households with stable IDs. Saved ${out}; nothing imported.`,
      );
    } else if (action === "check") {
      console.log(
        `Valid: ${input.households.length} households, ${input.households.reduce((n, h) => n + h.guests.length, 0)} guests. Nothing imported.`,
      );
    } else if (action === "plan") {
      const out = values.out || "private/guest-plan.json";
      privatePath(out);
      const { result } = await api(
        "/api/admin/guests/plan",
        input,
        connection(values.session),
      );
      writePrivate(out, result);
      console.log(
        `Preview: ${result.summary.create} new, ${result.summary.update} updated, ${result.summary.unchanged} unchanged households; ${result.conflicts.length} conflicts, ${result.warnings.length} warnings. Review ${out}. Nothing imported.`,
      );
    } else if (action === "apply") {
      if (!values.plan) throw new Error("Apply needs a reviewed --plan file.");
      const plan = readPrivate(values.plan),
        out = values.out || `private/invitations-${randomUUID()}.json`;
      if (plan.conflicts?.length)
        throw new Error("Resolve import conflicts before applying.");
      if (existsSync(privatePath(out)))
        throw new Error(
          "Use a new output path to preserve earlier invitation codes.",
        );
      const { result } = await api(
        "/api/admin/guests/apply",
        { data: input, fingerprint: plan.fingerprint },
        connection(values.session),
      );
      writePrivate(out, result, { overwrite: false });
      console.log(
        `Imported: ${result.summary.create} new, ${result.summary.update} updated households. Private invitation links saved to ${out}. No invitations were emailed.`,
      );
    } else throw new Error("Choose guests prepare, check, plan or apply.");
    return;
  }
  if (command === "export") {
    const out = values.out || "private/guest-export.json";
    privatePath(out);
    const { result } = await api(
      "/api/admin/export",
      undefined,
      connection(values.session),
    );
    writePrivate(out, result);
    console.log(`Guest responses and operations data saved to ${out}.`);
    return;
  }
  if (command === "mail") {
    const draft = mailDraftSchema.parse(
      readJson(values.file || "private/mail-draft.json"),
    );
    if (action === "preview") {
      const out = values.out || "private/mail-preview.json";
      privatePath(out);
      const { result } = await api(
        "/api/admin/mail/plan",
        draft,
        connection(values.session),
      );
      writePrivate(out, { ...result, campaignId: randomUUID() });
      writePrivate(`${out}.html`, result.html);
      console.log(
        `Preview: ${result.recipientCount} recipients, ${result.missingEmailHouseholds} households without an email. Review ${out} and ${out}.html. Nothing queued.`,
      );
    } else if (action === "send") {
      if (!values.send || !values.plan)
        throw new Error(
          "Sending needs a reviewed --plan and explicit --send. Ask the owner to review the concrete draft and recipients first.",
        );
      const plan = readPrivate(values.plan);
      if (JSON.stringify(draft) !== JSON.stringify(plan.draft))
        throw new Error(
          "The draft changed. Generate and review a fresh preview.",
        );
      const { result } = await api(
        "/api/admin/mail/send",
        {
          draft,
          fingerprint: plan.fingerprint,
          campaignId: plan.campaignId,
          confirm: true,
        },
        connection(values.session),
      );
      console.log(
        result.replay
          ? "This campaign was already queued; no duplicate mail was added."
          : `${result.queued} messages queued. Check the host dashboard and Resend delivery activity.`,
      );
    } else throw new Error("Choose mail preview or send.");
    return;
  }
  throw new Error("Unknown command. Use npm run wedding -- --help.");
}

main().catch((error) => {
  // Schema errors can include source values. Keep them out of terminal logs.
  if (error?.issues)
    console.error(
      `Validation failed at: ${error.issues.map((issue) => issue.path.join(".")).join(", ")}. Check the private input against the documented format.`,
    );
  else
    console.error(
      error instanceof SyntaxError
        ? "Invalid JSON in the input file."
        : error.message,
    );
  process.exitCode = 1;
});
