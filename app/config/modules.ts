import type { WeddingConfig } from "./schema";
import { DomainError } from "../domain/errors";

// One registry drives navigation AND server-side feature gates.
export const modules = [
  { id: "home", label: "home" },
  { id: "timeline", label: "timeline" },
  { id: "travel", label: "travel" },
  { id: "faq", label: "faq" },
  { id: "registry", label: "registry", feature: "registry" },
  { id: "memories", label: "memories", feature: "memories" },
  { id: "seating", label: "seating", feature: "seating" },
  { id: "rsvp", label: "rsvp", feature: "rsvp" },
] as const;
export function enabledModules(config: WeddingConfig) {
  if (config.publication === "coming-soon")
    return modules.filter((module) => module.id === "home");
  return modules.filter(
    (module) => !("feature" in module) || config.features[module.feature],
  );
}
export function requireFeature(
  config: WeddingConfig,
  feature: keyof WeddingConfig["features"],
) {
  if (config.publication !== "published" || !config.features[feature])
    throw new DomainError(404, "notFound");
}
