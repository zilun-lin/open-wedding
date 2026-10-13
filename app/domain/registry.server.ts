import type { WeddingConfig } from "../config/schema";
import { requireFeature } from "../config/modules";
import { DomainError } from "./errors";
export async function reserveGift(
  db: D1Database,
  config: WeddingConfig,
  householdId: string,
  itemId: string,
) {
  requireFeature(config, "registry");
  const item = config.registry.find(
    (item) => item.id === itemId && item.kind === "gift",
  );
  if (!item) throw new DomainError(404, "notFound");
  const now = Date.now(),
    id = crypto.randomUUID();
  const result = await db
    .prepare(
      "INSERT INTO reservations(id,item_id,household_id,status,expires_at,created_at) SELECT ?,?,?,'reserved',?,? WHERE (SELECT COUNT(*) FROM reservations WHERE item_id=? AND (status='purchased' OR (status='reserved' AND expires_at>?)))<? AND NOT EXISTS(SELECT 1 FROM reservations WHERE item_id=? AND household_id=? AND (status='purchased' OR (status='reserved' AND expires_at>?)))",
    )
    .bind(
      id,
      itemId,
      householdId,
      now + 48 * 3600000,
      now,
      itemId,
      now,
      item.quantity,
      itemId,
      householdId,
      now,
    )
    .run();
  if (!result.meta.changes) throw new DomainError(409, "giftUnavailable");
  return { id };
}
