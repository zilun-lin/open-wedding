import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { parseConfig, weddingConfigSchema } from "../app/config/schema.ts";
parseConfig(JSON.parse(readFileSync("content/wedding.json", "utf8")));
if (process.argv.includes("--schema"))
  writeFileSync(
    "content/wedding.schema.json",
    JSON.stringify(
      z.toJSONSchema(weddingConfigSchema, { unrepresentable: "any" }),
      null,
      2,
    ) + "\n",
  );
console.log("Wedding configuration is valid in every enabled language.");
