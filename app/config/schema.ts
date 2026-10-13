import { z } from "zod";

export const localizedSchema = z
  .record(z.string().min(2), z.string().max(5000))
  .refine(
    (value) => "en" in value || "zh-Hans" in value,
    "Provide a supported translation",
  );
const id = z.string().regex(/^[a-z0-9-]{1,60}$/);
const externalUrl = z
  .string()
  .url()
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "Use an http or https URL",
  );
const date = z.string().datetime({ offset: true });
const venue = z.object({
  name: localizedSchema,
  address: localizedSchema,
  directions: localizedSchema,
  mapUrl: externalUrl.optional(),
});
export const weddingConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    publication: z.enum(["coming-soon", "published"]).default("published"),
    siteName: localizedSchema,
    locales: z
      .array(z.enum(["en", "zh-Hans"]))
      .min(1)
      .max(2),
    defaultLocale: z.enum(["en", "zh-Hans"]),
    partners: z.array(z.object({ name: localizedSchema })).length(2),
    celebrationAt: date,
    timeZone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Use an IANA time zone"),
    rsvpDeadline: date,
    welcome: localizedSchema,
    story: localizedSchema,
    contact: z.object({
      name: localizedSchema,
      email: z.string().email(),
      phone: z.string().max(50).optional(),
    }),
    theme: z.object({
      preset: z.enum(["sage", "terracotta", "midnight"]),
      accent: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    }),
    features: z.object({
      rsvp: z.boolean(),
      seating: z.boolean(),
      registry: z.boolean(),
      memories: z.boolean(),
    }),
    seatingReleaseAt: date,
    venue,
    events: z
      .array(
        z
          .object({
            id,
            name: localizedSchema,
            description: localizedSchema,
            startsAt: date,
            endsAt: date,
            venue,
            visibility: z.enum(["public", "invited"]),
            rsvp: z.boolean(),
          })
          .refine(
            (event) => Date.parse(event.endsAt) > Date.parse(event.startsAt),
            "Event must end after it starts",
          ),
      )
      .max(30),
    travel: z
      .array(
        z.object({
          id,
          title: localizedSchema,
          text: localizedSchema,
          url: externalUrl.optional(),
        }),
      )
      .max(30),
    faqs: z
      .array(
        z.object({ id, question: localizedSchema, answer: localizedSchema }),
      )
      .max(60),
    registry: z
      .array(
        z.object({
          id,
          title: localizedSchema,
          description: localizedSchema,
          kind: z.enum(["link", "gift", "fund"]),
          url: externalUrl,
          quantity: z.number().int().min(1).max(100),
        }),
      )
      .max(100),
    media: z.object({
      releaseAt: date,
      maxFileMb: z.number().int().min(1).max(90),
      maxFilesPerHousehold: z.number().int().min(1).max(500),
      maxTotalMbPerHousehold: z.number().int().min(1).max(20000),
    }),
  })
  .superRefine((config, context) => {
    if (!config.locales.includes(config.defaultLocale))
      context.addIssue({
        code: "custom",
        path: ["defaultLocale"],
        message: "Default locale must be enabled",
      });
    if (new Set(config.locales).size !== config.locales.length)
      context.addIssue({
        code: "custom",
        path: ["locales"],
        message: "Locales must be unique",
      });
    for (const section of ["events", "travel", "faqs", "registry"] as const) {
      if (
        new Set(config[section].map((item) => item.id)).size !==
        config[section].length
      )
        context.addIssue({
          code: "custom",
          path: [section],
          message: "IDs must be unique within a section",
        });
    }
    const visit = (value: unknown, path: (string | number)[] = []) => {
      if (Array.isArray(value))
        return value.forEach((item, i) => visit(item, [...path, i]));
      if (!value || typeof value !== "object") return;
      const entries = Object.entries(value);
      if (entries.some(([key]) => key === "en" || key === "zh-Hans")) {
        for (const locale of config.locales)
          if (
            typeof (value as Record<string, unknown>)[locale] !== "string" ||
            !(value as Record<string, string>)[locale].trim()
          )
            context.addIssue({
              code: "custom",
              path: [...path, locale],
              message: "Add a translation for each enabled language",
            });
      } else entries.forEach(([key, item]) => visit(item, [...path, key]));
    };
    visit(config);
  });
export type WeddingConfig = z.infer<typeof weddingConfigSchema>;
export type Localized = z.infer<typeof localizedSchema>;
export function localize(value: Localized, locale: string, fallback = "en") {
  return value[locale] ?? value[fallback] ?? Object.values(value)[0] ?? "";
}
export function parseConfig(value: unknown) {
  return weddingConfigSchema.parse(value);
}
export function formatDate(
  value: string,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long" },
) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(
    new Date(value),
  );
}
