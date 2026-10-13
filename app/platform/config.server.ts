import defaults from "../../content/wedding.json";
import { parseConfig, type WeddingConfig } from "../config/schema";
export function getConfig(): WeddingConfig {
  return parseConfig(defaults);
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
