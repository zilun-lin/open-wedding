# Make it yours

Open Wedding separates celebration content from application behavior. No real couple, guests, credentials, or vendor accounts are included. Alex, Jordan, the venue and registry links are fictional examples.

## Without editing code

Open `/admin` after installation, create your host account with the setup token, then choose **Website settings**. Edit names, dates, contact details, theme and feature switches. Expand the content sections for bilingual text, venue, events, travel, FAQs, registry and gallery limits. Save once to publish the changes to your own running site.

The JSON editor supports bulk changes. **Download configuration** makes a portable copy. You can paste another installation's configuration into the editor; validation catches missing translations, duplicate IDs, invalid URLs, dates and time zones. Guest records and secrets are separate from this export.

## File defaults and saved settings

`content/wedding.json` is the tracked default. `app/config/schema.ts` validates it and every admin update. Once an administrator saves settings, D1's `settings.wedding` value takes precedence over the file. Editing the file after that does not overwrite live settings: paste the new file into the dashboard to apply it.

`schemaVersion` currently equals `1`. Changes to configuration structure need an explicit migration rather than silently interpreting an older configuration.

## Decisions you control

| Setting                      | Behavior                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `locales`, `defaultLocale`   | Enable English (`en`) and/or Simplified Chinese (`zh-Hans`). Every enabled language needs every content translation. |
| `theme.preset`               | `sage`, `terracotta`, or `midnight`; all share the same accessible layout.                                           |
| `theme.accent`               | Optional six-digit hex color. Check text contrast before using a custom color.                                       |
| `timeZone`                   | IANA zone such as `Europe/London` or `Asia/Shanghai`. All displayed event dates use this zone.                       |
| `celebrationAt`, event dates | ISO 8601 timestamps with explicit UTC offsets. Calendar downloads use equivalent UTC instants.                       |
| `features`                   | Disable RSVP, seating, registry or memories. Navigation, pages and APIs enforce the same switches.                   |
| Event `visibility`           | `public` or `invited`. Invite-only event details appear only to households explicitly invited to that event.         |
| Event `rsvp`                 | Whether that invited event collects a response for each household member.                                            |
| `rsvpDeadline`               | Replies and edits close at this server-enforced timestamp.                                                           |
| `seatingReleaseAt`           | Before this time, guests cannot receive table assignments.                                                           |
| `media.releaseAt`            | Opens guest uploads and the approved gallery. Host review works earlier.                                             |
| Registry `kind`              | `link` or `fund` opens an external site; `gift` also supports quantity-limited reservations.                         |
| Media limits                 | Per-file, per-household count and total storage limits. Single files are capped at 90 MB.                            |

Keep event and registry IDs stable after sending invitations or collecting reservations. An ID is the relationship key, not a display label. Rename the bilingual label when wording changes.

An invitation grants access to every named guest in one household, without guest accounts or public name search. Generate invitations in the dashboard, copy each one-time code/link and send it privately. Links place codes in URL fragments, then clear them immediately on redemption. Rotating a code also revokes that household's current sessions.

Seating uses accepted responses and table capacity. Assignments are per event. Guests see their household's table labels; the full guest list stays in the host dashboard.

## An AI customization brief

Give an agent this repository and a brief like:

> Read AGENTS.md and docs/configuration.md. Customize content/wedding.json for our fictional example using English and Simplified Chinese. Use a terracotta theme. Include a ceremony, reception, and invite-only welcome dinner. Keep domain logic and access controls intact. Validate all translations and run npm run verify. Do not include guest data or secrets in commits.

Changing presentation usually needs `app/features/`, `app/components/`, or `app/app.css`. Adding a new capability needs the module registry, schema, view, server permission checks, and focused integration tests. See [architecture.md](architecture.md).
