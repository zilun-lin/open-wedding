import {
  readFileSync,
  writeFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  chmodSync,
  renameSync,
} from "node:fs";
import { resolve, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const privateRoot = resolve(repoRoot, "private");

export function privatePath(file) {
  const target = resolve(repoRoot, file),
    rel = relative(privateRoot, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || rel.startsWith(sep))
    throw new Error(
      "Output must be a file inside this checkout's ignored private/ directory.",
    );
  const parts = relative(repoRoot, target).split(sep);
  let current = repoRoot;
  for (const part of parts) {
    current = resolve(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error("Private files must not use symlinks.");
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  chmodSync(privateRoot, 0o700);
  return target;
}

export function writePrivate(file, value, { overwrite = true } = {}) {
  const target = privatePath(file);
  if (!overwrite && existsSync(target))
    throw new Error(
      "Output already exists. Choose another private path or explicitly use --overwrite.",
    );
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(
    temporary,
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  renameSync(temporary, target);
}

export function readPrivate(file) {
  const target = privatePath(file);
  chmodSync(target, 0o600);
  return JSON.parse(readFileSync(target, "utf8"));
}

export function readJson(file) {
  return JSON.parse(readFileSync(resolve(repoRoot, file), "utf8"));
}
