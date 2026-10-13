import { describe, it, expect, afterEach } from "vitest";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  unlinkSync,
  symlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const files: string[] = [];
const path = (suffix: string) => {
  const file = `private/test-${randomUUID()}${suffix}`;
  files.push(file);
  return file;
};
const run = (args: string[]) =>
  spawnSync(process.execPath, ["scripts/wedding.mjs", ...args], {
    encoding: "utf8",
    timeout: 15000,
  });
afterEach(() => {
  for (const file of files.splice(0)) {
    try {
      unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
});

describe("private agent tooling", () => {
  it("prepares stable keys across contact and name changes, in ignored owner-only files", () => {
    const output = path(".json"),
      next = path(".json"),
      input = path(".json");
    const first = run([
      "guests",
      "prepare",
      "--file",
      "examples/guest-draft.json",
      "--out",
      output,
    ]);
    expect(first.status, first.stderr).toBe(0);
    const original = JSON.parse(readFileSync(output, "utf8"));
    const draft = JSON.parse(readFileSync("examples/guest-draft.json", "utf8"));
    draft.households[0].name = "Renamed household";
    draft.households[0].email = "updated@example.com";
    draft.households[0].guests[0].name = "Renamed Guest";
    writeFileSync(input, JSON.stringify(draft), { mode: 0o600 });
    const changed = run(["guests", "prepare", "--file", input, "--out", next]);
    expect(changed.status, changed.stderr).toBe(0);
    const prepared = JSON.parse(readFileSync(next, "utf8"));
    expect(prepared.households[0].id).toBe(original.households[0].id);
    expect(prepared.households[0].guests[0].id).toBe(
      original.households[0].guests[0].id,
    );
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(statSync("private").mode & 0o777).toBe(0o700);
    expect(
      spawnSync("git", ["check-ignore", output], { encoding: "utf8" }).status,
    ).toBe(0);
    expect(first.stdout).not.toContain("guest@example.com");
    expect(
      run([
        "guests",
        "prepare",
        "--file",
        "examples/guest-draft.json",
        "--out",
        output,
      ]).status,
    ).not.toBe(0);
  });
  it("rejects tracked output paths and symlink destinations", () => {
    const output = `examples/test-${randomUUID()}.json`;
    expect(
      run([
        "guests",
        "prepare",
        "--file",
        "examples/guest-draft.json",
        "--out",
        output,
      ]).status,
    ).not.toBe(0);
    expect(existsSync(output)).toBe(false);
    const valid = path(".json"),
      linked = path(".json");
    expect(
      run([
        "guests",
        "prepare",
        "--file",
        "examples/guest-draft.json",
        "--out",
        valid,
      ]).status,
    ).toBe(0);
    symlinkSync(valid.split("/")[1], linked);
    const blocked = run([
      "guests",
      "prepare",
      "--file",
      "examples/guest-draft.json",
      "--out",
      linked,
      "--overwrite",
    ]);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain("symlinks");
  });
  it("keeps invalid source values out of validation output", () => {
    const directorySeed = path(".json");
    expect(
      run([
        "guests",
        "prepare",
        "--file",
        "examples/guest-draft.json",
        "--out",
        directorySeed,
      ]).status,
    ).toBe(0);
    const input = path(".json"),
      draft = JSON.parse(readFileSync("examples/guest-draft.json", "utf8"));
    draft.households[0].email = "PRIVATE-INVALID-EMAIL";
    writeFileSync(input, JSON.stringify(draft), { mode: 0o600 });
    const result = run(["guests", "prepare", "--file", input]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("households.0.email");
    expect(result.stderr + result.stdout).not.toContain(
      "PRIVATE-INVALID-EMAIL",
    );
  });
});
