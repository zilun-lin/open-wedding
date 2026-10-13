# Open Wedding

A modular wedding website you can own, configure and share. English and Mandarin are included, alongside household invitations, RSVPs, private seating, registry links and a moderated photo/video album.

Built for a couple's own deployment, with fictional example content and an MIT license. Make a copy with GitHub's **Use this template** button, then open it in Codex or Claude Code. Give the agent your existing guest list, invitation design and planning materials; [the intake workflow](docs/agent-workflow.md) guides it through the decisions, site customization and private operations. Website content and design live in source files, with no website editor.

## Try it locally

Install [Node.js 22.18+](https://nodejs.org/) and run:

```sh
git clone https://github.com/zilun-lin/open-wedding.git
cd open-wedding
npm ci
npm run demo:dev
```

Open the URL printed by the dev server. Use `DEMO-WELCOME` on the RSVP page to try the fictional invitation. Visit `/admin` with the setup token printed by the demo script to create your local host account.

No Cloudflare or Resend signup is needed to try it locally. Local email stays in the outbox until credentials are supplied. For a clean installation without example guests, use `npm run setup` instead of `npm run demo`.

## Included

| Guests                                                           | Hosts                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| English/Mandarin navigation and content                          | Agent guidance and validated repository configuration         |
| Timeline, travel, venue, FAQs and calendar downloads             | Three themes and shared feature switches                      |
| Private household invitations without guest accounts             | Reviewed imports, stable IDs, private links and code rotation |
| Per-person, per-event RSVP; dietary/access and transport notes   | Response overview and private guest-data export               |
| Confirmation emails and editable replies before the deadline     | Audience previews, campaign deduplication and durable retries |
| Household table assignments after a release time                 | Accepted-guest seating with table capacity enforcement        |
| External registries/funds and quantity-limited gift reservations | Registry configuration; no payment processing to set up       |
| Private approved photos/videos and original downloads            | Upload quotas and approval/deletion controls                  |

The repository contains meaningful D1 integration tests, CI, contributor documentation, a security policy and [AI-agent guidance](AGENTS.md).

## Make it yours

The authoritative content is [`content/wedding.json`](content/wedding.json). Wedding details live there rather than inside components. Your agent edits the files and deploys an update; D1/R2 preserve private guest data and uploads. The host dashboard handles invitations, seating, moderation and email operations.

Start with [configuration.md](docs/configuration.md). Edit names, dates, language content, venue, events, travel, FAQs, registry links, theme, feature switches and release times. Keep existing event/gift IDs stable after collecting responses.

For AI customization, start with [the copyable prompt and workflow](docs/agent-workflow.md). Codex and Claude Code share [AGENTS.md](AGENTS.md) through [CLAUDE.md](CLAUDE.md). Accessible connected sources or raw exports/uploads are supported as agent inputs; the application does not need its own Canva, spreadsheet or mailbox OAuth integration.

```sh
npm run wedding -- intake
npm run wedding -- --help
```

The tools prepare stable guest records, preview/apply imports, export current replies and preview/send reviewed mail. Materials, source links, credentials and invitation links stay in ignored `private/`, with owner-only file permissions. Guest imports do not send invitations. Mail previews select real recipients by language, invited event and response status; a separate explicit send uses the reviewed campaign ID.

## Deploy with two accounts

The default stack is **Cloudflare + Resend**:

- React Router, React and TypeScript on a Cloudflare Worker.
- D1 for relational guest data; R2 for private media; Queues and cron for email recovery.
- Better Auth with Drizzle for hosts; invitation sessions for guests.
- Resend and React Email for email; i18next for language support; Uppy for uploads.

```sh
npm run cloudflare:setup
npm run deploy
```

The setup helper provisions your database and secrets; Wrangler provisions the other bindings on deployment. Account-specific configuration stays in an ignored instance file. Then configure your Resend API key, a DNS-verified sending domain and the site origin.

Follow [deployment.md](docs/deployment.md), including the email verification and recovery steps. Cloudflare/R2 may require billing activation. Live cloud deployment and real email delivery need your accounts; local tests do not substitute for those checks.

## Scope and limits

This is a functional starter for one wedding per deployment, not a managed service. The current version has one initial host account. Public information is visible to anyone; invitations protect guest records, table assignments and media.

Files are streamed to private R2 storage, with a configurable ceiling of 90 MB per file. The starter accepts JPEG, PNG, WebP, MP4 and WebM. It does not transcode video, remove EXIF metadata, scan files or resume interrupted uploads. The gallery currently shows the newest 200 approved files. Gift funds use trusted external links.

Agents normalize source exports into the documented JSON guest format; arbitrary CSV/workbook parsing is not built into the CLI. Continuous source syncing, spreadsheet write-back, personalized invitation emails, scheduled reminders, album pagination and email bounce webhooks remain follow-up work. See the [wedding coordinator checklist](docs/wedding-checklist.md) for operational details to confirm before inviting guests.

## Development

```sh
npm run verify   # configuration, types, integration tests, production build
npm run format   # consistent formatting
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Keep all guest lists, credentials, invitation codes and local storage out of the public repository.
