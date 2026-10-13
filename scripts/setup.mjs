import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
const wrangler = (args) => {
  const result = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", ...args],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status || 1);
};
const demo = process.argv.includes("--demo"),
  quiet = process.argv.includes("--quiet");
if (!existsSync(".dev.vars"))
  writeFileSync(
    ".dev.vars",
    `AUTH_SECRET=${randomBytes(32).toString("hex")}\nSETUP_TOKEN=${randomBytes(24).toString("hex")}\n`,
    { mode: 0o600 },
  );
wrangler([
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--config",
  "wrangler.jsonc",
]);
if (demo) {
  const vars = readFileSync(".dev.vars", "utf8");
  if (
    /APP_ORIGIN=.+/.test(vars) &&
    !vars.includes("localhost") &&
    !vars.includes("127.0.0.1")
  )
    throw new Error(
      "Demo data is local only. Remove a production APP_ORIGIN before seeding.",
    );
  const hash = createHash("sha256").update("DEMO-WELCOME").digest("hex"),
    household = "72db2399-0453-402a-bf60-bad6bc9b7a75",
    guest = "1053b7de-6bba-4b8f-9e46-db316d1c1223";
  const config = JSON.parse(readFileSync("content/wedding.json", "utf8"));
  config.media.releaseAt = "2000-01-01T00:00:00Z";
  config.seatingReleaseAt = "2000-01-01T00:00:00Z";
  config.events.push({
    ...structuredClone(config.events[0]),
    id: "private-smoke",
    visibility: "invited",
    name: { en: "PRIVATE-SMOKE-EVENT", "zh-Hans": "私密测试活动" },
  });
  writeFileSync(
    ".wrangler/demo-wedding.json",
    JSON.stringify(config, null, 2),
    { mode: 0o600 },
  );
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const sql = `INSERT OR IGNORE INTO households(id,name,email,locale,code_hash) VALUES (${quote(household)},'Example household',NULL,'en',${quote(hash)});\nINSERT OR IGNORE INTO guests(id,household_id,name,category) VALUES (${quote(guest)},${quote(household)},'Example Guest','adult');\n${config.events.map((event) => `INSERT OR IGNORE INTO invitations(household_id,event_id) VALUES (${quote(household)},${quote(event.id)});`).join("\n")}\n`;
  writeFileSync(".wrangler/demo.sql", sql, { mode: 0o600 });
  wrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    "wrangler.jsonc",
    "--file",
    ".wrangler/demo.sql",
  ]);
  if (!quiet)
    console.log(
      "Local example invitation code: DEMO-WELCOME (never created in production)",
    );
}
if (!quiet) {
  const token = readFileSync(".dev.vars", "utf8").match(
    /^SETUP_TOKEN=(.+)$/m,
  )?.[1];
  console.log(
    `\nReady. Run npm run dev, then open /admin.\nYour local setup token: ${token}\nKeep .dev.vars private.\n`,
  );
}
