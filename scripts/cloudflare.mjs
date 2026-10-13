import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
const command = (args, { capture = false, input } = {}) => {
  const result = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", ...args],
    {
      stdio: capture
        ? ["pipe", "pipe", "inherit"]
        : input !== undefined
          ? ["pipe", "inherit", "inherit"]
          : "inherit",
      input,
      encoding: "utf8",
    },
  );
  if (result.status !== 0)
    throw new Error(`Wrangler ${args.slice(0, 2).join(" ")} failed`);
  return result.stdout;
};
if (process.argv.includes("--deploy")) {
  if (!existsSync("wrangler.instance.json"))
    throw new Error("Run npm run cloudflare:setup first.");
  command([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "--config",
    "wrangler.instance.json",
  ]);
  const build = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
  if (build.status) process.exit(build.status);
  // Vite writes .wrangler/deploy/config.json pointing at its compiled Worker.
  command(["deploy"]);
  console.log(
    "Deployment finished. Keep wrangler.instance.json and your Cloudflare resources for later updates.",
  );
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (existsSync("wrangler.instance.json"))
      throw new Error(
        "This checkout is already configured. Run npm run deploy for updates; keep your existing authentication secrets.",
      );
    console.log(
      "This provisions resources in YOUR Cloudflare account. Cloudflare may ask you to enable R2 and billing; choose your own storage budget.",
    );
    const name = (
      await rl.question(
        "Unique project name (lowercase letters, numbers and hyphens): ",
      )
    ).trim();
    if (!/^[a-z][a-z0-9-]{2,40}$/.test(name))
      throw new Error("Use 3–41 lowercase characters, starting with a letter.");
    command(["login"]);
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    config.name = name;
    config.d1_databases[0].database_name = `${name}-db`;
    config.queues.producers[0].queue = `${name}-email`;
    config.queues.consumers[0].queue = `${name}-email`;
    writeFileSync(
      "wrangler.instance.json",
      JSON.stringify(config, null, 2) + "\n",
    );
    let databases = JSON.parse(
      command(["d1", "list", "--json"], { capture: true }),
    );
    if (!databases.some((db) => db.name === `${name}-db`)) {
      command([
        "d1",
        "create",
        `${name}-db`,
        "--config",
        "wrangler.instance.json",
        "--update-config",
        "--binding",
        "DB",
      ]);
      databases = JSON.parse(
        command(["d1", "list", "--json"], { capture: true }),
      );
    }
    const database = databases.find((db) => db.name === `${name}-db`);
    if (!database) throw new Error("Database not found after provisioning.");
    const updated = JSON.parse(readFileSync("wrangler.instance.json", "utf8"));
    updated.d1_databases = [
      {
        binding: "DB",
        database_name: database.name,
        database_id: database.uuid,
        migrations_dir: "migrations",
      },
    ];
    writeFileSync(
      "wrangler.instance.json",
      JSON.stringify(updated, null, 2) + "\n",
    );
    // R2 and Queues are provisioned automatically by Wrangler on first deploy.
    command([
      "d1",
      "migrations",
      "apply",
      "DB",
      "--remote",
      "--config",
      "wrangler.instance.json",
    ]);
    const authSecret = randomBytes(32).toString("hex"),
      setupToken = randomBytes(24).toString("hex");
    // Secrets go over stdin. No keys are written to a tracked file or process arguments.
    command(["secret", "bulk", "--config", "wrangler.instance.json"], {
      input: JSON.stringify({
        AUTH_SECRET: authSecret,
        SETUP_TOKEN: setupToken,
      }),
    });
    console.log(
      `\nProduction setup token: ${setupToken}\nSave it privately. Run npm run deploy, then open /admin on the returned URL.\nSet RESEND_API_KEY and EMAIL_FROM as Worker secrets using the instructions in docs/deployment.md.\n`,
    );
  } finally {
    rl.close();
  }
}
