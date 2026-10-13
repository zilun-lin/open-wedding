# Contributing

Use Node 22.18+ and `npm ci`, then `npm run demo:dev`. The sample invitation is `DEMO-WELCOME`; the setup script prints the local host-account setup token. No production accounts are needed for development. Read `docs/agent-workflow.md` for the owner/agent experience.

Keep changes reusable. Wedding details belong in configuration, and translations should cover every supported language. New features should follow `AGENTS.md` and the extension checklist in `docs/architecture.md`.

Use fictional fixtures. Avoid screenshots or logs containing real guest details or invitation codes. Do not commit generated bindings, secrets or local storage.

Before opening a pull request, run `npm run format` and `npm run verify`. Describe the resulting guest or host behavior, the tests run, and any remaining limitations. Include database migrations for schema changes and document new settings.

Useful follow-up work includes personalized invitation emails, album pagination, scheduled reminders, email delivery/bounce webhooks, EXIF removal and resumable video uploads. Keep customization in source; do not add a CMS or document-provider OAuth just to read agent inputs. Discuss a provider swap or multi-tenant conversion before undertaking it: those change the deployment and privacy assumptions.

For the HTTP smoke test, keep local email credentials unset, run `npm run demo:dev` in one terminal and `npm run smoke` in another. To test the compiled Worker, run `npm run demo:preview -- --host 127.0.0.1 --port 4173`, then `SMOKE_ORIGIN=http://127.0.0.1:4173 npm run smoke`. It is restricted to loopback hosts and uses fictional fixture accounts. Use a fresh local database if you already created a different host account.
