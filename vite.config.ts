import { existsSync } from "node:fs";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [
    cloudflare({
      configPath:
        command === "build" && existsSync("wrangler.instance.json")
          ? "wrangler.instance.json"
          : "wrangler.jsonc",
      viteEnvironment: { name: "ssr" },
    }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
}));
