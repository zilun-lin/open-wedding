import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => ({
  plugins: [
    cloudflare({
      configPath:
        command === "build" &&
        mode !== "demo" &&
        existsSync("wrangler.instance.json")
          ? "wrangler.instance.json"
          : "wrangler.jsonc",
      viteEnvironment: { name: "ssr" },
    }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    alias:
      mode === "demo"
        ? [
            {
              find: "../../content/wedding.json",
              replacement: resolve(".wrangler/demo-wedding.json"),
            },
          ]
        : [],
    tsconfigPaths: true,
  },
}));
