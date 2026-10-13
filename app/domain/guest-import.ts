import { z } from "zod";

export const guestImportSchema = z
  .object({
    schemaVersion: z.literal(1),
    households: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: z.string().trim().min(1).max(100),
            email: z
              .string()
              .trim()
              .email()
              .toLowerCase()
              .nullable()
              .default(null),
            locale: z.enum(["en", "zh-Hans"]),
            eventIds: z.array(z.string().regex(/^[a-z0-9-]{1,60}$/)).max(30),
            guests: z
              .array(
                z
                  .object({
                    id: z.string().uuid(),
                    name: z.string().trim().min(1).max(100),
                    category: z.enum(["adult", "child", "infant"]),
                  })
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

export type GuestImport = z.infer<typeof guestImportSchema>;

export function parseGuestImport(
  input: unknown,
  config: {
    events: { id: string }[];
    locales: string[];
  },
): GuestImport {
  return guestImportSchema
    .superRefine((data, ctx) => {
      const householdIds = new Set<string>(),
        guestIds = new Set<string>();
      data.households.forEach((household, i) => {
        const issue = (field: string, message: string) =>
          ctx.addIssue({
            code: "custom",
            path: ["households", i, field],
            message,
          });
        if (householdIds.has(household.id))
          issue("id", "Duplicate household ID");
        householdIds.add(household.id);
        if (!config.locales.includes(household.locale))
          issue("locale", "Language is not enabled");
        if (new Set(household.eventIds).size !== household.eventIds.length)
          issue("eventIds", "Duplicate event ID");
        if (
          household.eventIds.some(
            (id) => !config.events.some((event) => event.id === id),
          )
        )
          issue("eventIds", "Unknown event ID");
        household.guests.forEach((guest) => {
          if (guestIds.has(guest.id)) issue("guests", "Duplicate guest ID");
          guestIds.add(guest.id);
        });
      });
    })
    .parse(input);
}
