import { createHash } from "node:crypto";
import { z } from "zod";
import {
  guestImportSchema,
  parseGuestImport,
} from "../app/domain/guest-import.ts";

const sourceKey = z.string().trim().min(1).max(500);
const household = guestImportSchema.shape.households.element;
const draftSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceId: sourceKey,
    households: z
      .array(
        household
          .omit({ id: true, guests: true })
          .extend({
            sourceKey,
            guests: z
              .array(
                household.shape.guests.element
                  .omit({ id: true })
                  .extend({ sourceKey })
                  .strict(),
              )
              .min(1)
              .max(20),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

// UUIDv5 with the standard URL namespace. The source ID/key is private and must
// stay stable across exports; names, email addresses and row numbers are not keys.
function stableId(value) {
  const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const hash = createHash("sha1")
    .update(namespace)
    .update(value)
    .digest()
    .subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function prepareGuestDraft(input, config) {
  const draft = draftSchema.parse(input);
  return parseGuestImport(
    {
      schemaVersion: 1,
      households: draft.households.map(({ sourceKey: key, guests, ...h }) => ({
        ...h,
        id: stableId(
          JSON.stringify(["open-wedding", draft.sourceId, "household", key]),
        ),
        guests: guests.map(({ sourceKey: guestKey, ...g }) => ({
          ...g,
          id: stableId(
            JSON.stringify(["open-wedding", draft.sourceId, "guest", guestKey]),
          ),
        })),
      })),
    },
    config,
  );
}
