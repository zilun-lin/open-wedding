import defaults from "../../content/wedding.json";
import { parseConfig, type WeddingConfig } from "../config/schema";
export function getConfig(): WeddingConfig {
  return parseConfig(defaults);
}
// A pre-launch response contains only explicitly published announcement fields.
export function announcementConfig(config: WeddingConfig) {
  const { siteName, partners, welcome, theme, locales, defaultLocale } = config;
  return { siteName, partners, welcome, theme, locales, defaultLocale };
}
export async function invitedEvents(db: D1Database, householdId?: string) {
  if (!householdId) return [];
  return (
    await db
      .prepare("SELECT event_id FROM invitations WHERE household_id=?")
      .bind(householdId)
      .all<{ event_id: string }>()
  ).results.map((row) => row.event_id);
}
export function visibleConfig(config: WeddingConfig, invited: string[]) {
  return {
    ...config,
    events: config.events.filter(
      (event) => event.visibility === "public" || invited.includes(event.id),
    ),
  };
}
