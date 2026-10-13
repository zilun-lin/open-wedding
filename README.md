# Open Wedding

A modular wedding website you can own, configure and share. English and Mandarin are included, alongside household invitations, RSVPs, private seating, registry links and a moderated photo/video album.

Built for a couple's own deployment, with fictional example content and an MIT license. Make a copy with GitHub's **Use this template** button, then customize it through the host dashboard or an AI agent.

## Try it locally

Install [Node.js 22.18+](https://nodejs.org/) and run:

```sh
git clone https://github.com/zilun-lin/open-wedding.git
cd open-wedding
npm ci
npm run demo
npm run dev
```

Open the URL printed by the dev server. Use `DEMO-WELCOME` on the RSVP page to try the fictional invitation. Visit `/admin` with the setup token printed by the demo script to create your local host account.

No Cloudflare or Resend signup is needed to try it locally. Local email stays in the outbox until credentials are supplied. For a clean installation without example guests, use `npm run setup` instead of `npm run demo`.

## Included

| Guests                                                           | Hosts                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| English/Mandarin navigation and content                          | Bilingual content forms and validated JSON import/export     |
| Timeline, travel, venue, FAQs and calendar downloads             | Three themes and shared feature switches                     |
| Private household invitations without guest accounts             | Invitation creation, one-time links and code rotation        |
| Per-person, per-event RSVP; dietary/access and transport notes   | Response overview and private guest-data export              |
| Confirmation emails and editable replies before the deadline     | Durable email outbox, queue retries and email-update preview |
| Household table assignments after a release time                 | Accepted-guest seating with table capacity enforcement       |
| External registries/funds and quantity-limited gift reservations | Registry configuration; no payment processing to set up      |
| Private approved photos/videos and original downloads            | Upload quotas and approval/deletion controls                 |

The repository contains meaningful D1 integration tests, CI, contributor documentation, a security policy and [AI-agent guidance](AGENTS.md).

## Make it yours

The tracked default is [`content/wedding.json`](content/wedding.json). Wedding details live there rather than inside components. The host dashboard can override those defaults without editing source or redeploying.

Start with [configuration.md](docs/configuration.md). Edit names, dates, language content, venue, events, travel, FAQs, registry links, theme, feature switches and release times. Keep existing event/gift IDs stable after collecting responses.

For AI customization, give the agent this repository, your design/content brief and `AGENTS.md`. The [architecture guide](docs/architecture.md) explains where presentation, domain rules, provider integrations and runtime wiring live.

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

Scheduled reminders, CSV invitation imports, album pagination and email bounce webhooks are documented follow-up work. See the [wedding coordinator checklist](docs/wedding-checklist.md) for operational details to confirm before inviting guests.

## Development

```sh
npm run verify   # configuration, types, integration tests, production build
npm run format   # consistent formatting
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Keep all guest lists, credentials, invitation codes and local storage out of the public repository.
