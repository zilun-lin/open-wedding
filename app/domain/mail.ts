import { z } from "zod";

export const mailDraftSchema = z
  .object({
    subject: z.string().trim().min(1).max(150),
    message: z.string().trim().min(1).max(5000),
    locale: z.enum(["en", "zh-Hans"]),
    eventId: z
      .string()
      .regex(/^[a-z0-9-]{1,60}$/)
      .optional(),
    audience: z.enum(["all", "awaiting-rsvp", "attending"]).default("all"),
  })
  .strict();
export type MailDraft = z.infer<typeof mailDraftSchema>;
