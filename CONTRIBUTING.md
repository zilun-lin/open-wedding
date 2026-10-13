# Contributing

Use Node 22.18+ and `npm ci`, then `npm run demo` and `npm run dev`. The sample invitation is `DEMO-WELCOME`; the setup script prints the local host-account setup token. No production accounts are needed for development.

Keep changes reusable. Wedding details belong in configuration, and translations should cover every supported language. New features should follow `AGENTS.md` and the extension checklist in `docs/architecture.md`.

Use fictional fixtures. Avoid screenshots or logs containing real guest details or invitation codes. Do not commit generated bindings, secrets or local storage.

Before opening a pull request, run `npm run format` and `npm run verify`. Describe the resulting guest or host behavior, the tests run, and any remaining limitations. Include database migrations for schema changes and document new settings.

Useful follow-up work includes CSV invitation import, album pagination, per-guest category editing, scheduled reminders, email delivery/bounce webhooks, EXIF removal and resumable video uploads. Discuss a provider swap or multi-tenant conversion before undertaking it: those change the deployment and privacy assumptions.

For the HTTP smoke test, keep local email credentials unset, run `npm run dev` in one terminal and `npm run smoke` in another. It is restricted to loopback hosts and uses fictional fixture accounts. Use a fresh local database if you already created a different host account.
