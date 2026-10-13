# Make it yours

Open Wedding separates celebration content from application behavior. No real couple, guests, credentials, or vendor accounts are included. Alex, Jordan, the venue and registry links are fictional examples.

## With your coding agent

Start with [agent-workflow.md](agent-workflow.md). Give your agent the repository and the materials you already have: a guest spreadsheet, invitation design, itinerary, notes and relevant emails. The agent can use an available authorized connector or work from uploaded/exported files. Website content is configured in `content/wedding.json`, validated by `app/config/schema.ts`, and published through a new deployment. There is no content editor in the website.

## One source of content

The repository's `content/wedding.json` is authoritative. The application does not read configuration overrides from D1. Private operational state, including replies, invitations and uploads, remains in the backend when website content is redeployed.

`schemaVersion` currently equals `1`. Changes to configuration structure need an explicit migration rather than silently interpreting an older configuration.

If upgrading an older installation that used **Website settings**, export its saved configuration before upgrading, validate it and move it into `content/wedding.json`. The old `settings.wedding` record is retained but ignored. No guest data is removed by this change.

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

An invitation grants access to every named guest in one household, without guest accounts or public name search. Import reviewed households with the agent tools or create invitations in the dashboard, copy each one-time code/link and send it privately. Links place codes in URL fragments, then clear them immediately on redemption. Rotating a code also revokes that household's current sessions.

Seating uses accepted responses and table capacity. Assignments are per event. Guests see their household's table labels; the full guest list stays in the host dashboard.

## An AI customization brief

Give an agent this repository and a brief like:

> Read AGENTS.md and docs/configuration.md. Customize content/wedding.json for our fictional example using English and Simplified Chinese. Use a terracotta theme. Include a ceremony, reception, and invite-only welcome dinner. Keep domain logic and access controls intact. Validate all translations and run npm run verify. Do not include guest data or secrets in commits.

Changing presentation usually needs `app/features/`, `app/components/`, or `app/app.css`. Adding a new capability needs the module registry, schema, view, server permission checks, and focused integration tests. See [architecture.md](architecture.md).
