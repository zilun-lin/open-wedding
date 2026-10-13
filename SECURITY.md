# Security reporting and operation

Report a suspected vulnerability privately through GitHub's **Report a vulnerability** action if enabled, or contact the repository owner privately. Do not include real guest data, active invitation codes, session tokens or API keys in a public issue.

The starter uses Better Auth for hosts, hashed random codes and HttpOnly cookies for guests, same-origin checks for writes, private R2 objects, server-side release times and SQLite constraints. Tests cover critical application boundaries; this is not an independent security audit.

Owners should verify their sender domain, protect their host account, limit media quotas, export an offline seating copy, and decide when to remove guest and media data. Dietary/accessibility fields can contain sensitive personal information; keep exports private and collect only what is needed.

Original media is not transcoded, scanned or stripped of metadata. Moderation is a host decision. MIME/signature checks prevent obvious active formats but are not malware analysis. Do not publish the R2 bucket or weaken authenticated file routes.

All basic celebration information is public by design. `noindex` does not make it private. Deploy a separate access gate if your event requires the entire website to be private.

The application currently supports one initial host account. Public signup remains disabled. Password reset requires working email; deployment recovery is documented in `docs/deployment.md`.
