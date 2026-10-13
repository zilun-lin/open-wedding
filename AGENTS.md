# Working on Open Wedding

This is a public, reusable wedding template. Preserve that distinction when customizing it.

- Read `docs/configuration.md` and `docs/architecture.md` before changing structure.
- Couple-specific text, dates, venue, event IDs and registry links belong in `content/wedding.json` or live admin settings.
- Guest lists, invitation codes, real email addresses, credentials, `.dev.vars`, local database state and `wrangler.instance.json` must never enter commits. Use fictional fixtures.
- Preserve the file-default/admin-override precedence. File edits do not overwrite saved live settings.
- Extend `app/config/schema.ts` and all enabled translations together. Validate configuration before using it.
- Keep reusable feature views under `app/features/`; keep styling separate from domain behavior.
- Apply server-side authorization and feature gates. Do not trust guest IDs, household IDs, event IDs, reservations or upload keys from the browser.
- Preserve atomic RSVP/outbox persistence, replay protection, table capacity and gift quantity constraints.
- Add new database migrations; do not rewrite an applied migration in an existing deployment.
- Use the existing Cloudflare/Resend stack unless the user's request calls for a different provider. Do not add new vendor accounts casually.
- Test meaningful boundaries introduced by the change. Run `npm run verify` before publishing source changes.
- Never deploy to a new live account or send real guest emails as a side effect of tests. Local setup and demo scripts must use `--local`.
- Keep the README honest about supported behavior and limits. Do not describe placeholders as finished integrations.

Useful commands: `npm ci`, `npm run demo`, `npm run dev`, `npm run verify`, `npm run format`.
