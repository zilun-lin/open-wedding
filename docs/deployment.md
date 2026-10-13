# Run and deploy

The production target is one Cloudflare Worker, one D1 database, one private R2 bucket, and one email queue. Resend handles outbound email. Local development needs no cloud accounts.

## Local installation

Install Node 22.18+ and clone your own copy of this template.

```sh
npm ci
npm run setup
npm run dev
```

`setup` generates an ignored `.dev.vars` file with random authentication and bootstrap secrets, and applies migrations to **local** D1 storage. It prints your local setup token. Open the URL printed by the dev server, visit `/admin`, use the token to create your account, and sign in. Public admin signup is disabled.

For a fictional guest invitation and early access to gallery/seating during development:

```sh
npm run demo:dev
```

The example invitation code is `DEMO-WELCOME`. Demo seeding always uses `--local`; the explicit demo Vite mode uses `examples/wedding.json` to generate an ignored fixture with early release times, independently of your content. Normal development and production use `content/wedding.json`. Never deploy the demo bundle or copy local D1 state/example codes into production; `npm run deploy` builds a fresh production bundle.

## First Cloudflare deployment

Create a Cloudflare account and enable Workers and R2. R2 onboarding can require billing details even when usage stays within the free allowance. Set a storage budget appropriate to the photos and videos you expect.

```sh
npm run cloudflare:setup
npm run deploy
```

The setup helper asks for a unique project name, opens Wrangler's Cloudflare login flow, creates/reuses that project's D1 database, creates its named private R2 bucket, applies migrations, and generates production `AUTH_SECRET` and `SETUP_TOKEN` secrets. Queues use Wrangler's resource provisioning on deployment. Account-specific bindings are stored in ignored `wrangler.instance.json`; the public template remains account-independent.

The **production setup token** is saved in ignored, owner-only `private/production-bootstrap.json`, without printing it in logs. Use it to create your production host account at `/admin`. Local accounts and guest data are not transferred.

For an agent using an existing Wrangler session, setup can run without prompts: `npm run cloudflare:setup -- --name your-wedding --skip-login --origin https://your-wedding.example`. The origin becomes the canonical URL for authentication and guest links; use that domain after attaching it. The helper parses JSONC and assigns an explicit project-specific media bucket. Keep each checkout's resources separate.

The helper refuses to overwrite an existing instance file, to avoid rotating a live installation's secrets unintentionally. If setup was interrupted, keep the file and inspect the steps below before continuing. Do not delete it casually: it identifies your data resources.

This provisioning flow must be exercised in your own Cloudflare account. Repository checks verify local Workers behavior and the compiled bundle; they do not imply that a live account deployment or real email delivery was performed.

## Email setup

Create a Resend account, verify a sending domain using the DNS records Resend provides, and create an API key. A real guest mailing flow requires an authorized sending domain; the test sender is not a general guest mailing address.

```sh
npx wrangler secret put RESEND_API_KEY --config wrangler.instance.json
npx wrangler secret put EMAIL_FROM --config wrangler.instance.json
npx wrangler secret put APP_ORIGIN --config wrangler.instance.json
```

Enter secrets at the prompt. `EMAIL_FROM` is a verified sender such as `Alex & Jordan <hello@celebration.example>`. `APP_ORIGIN` is your exact HTTPS origin, without a trailing slash or path. Use the same origin for guest links, the dashboard, authentication and password-reset redirects. Visit the host dashboard to check whether email credentials are configured.

Without email credentials, RSVP persistence still works and emails remain queued. Queues attempt delivery; the scheduled handler sweeps pending messages every ten minutes and recovers missed queue publications. Delivery retries use a stable Resend idempotency key and stop after five attempts. Ambiguous retries beyond the provider's deduplication window stop for manual review.

Check both the dashboard's delivery counts and Resend's delivery activity before inviting real guests. The application does not yet consume delivery/bounce webhooks, so `sent` means Resend accepted the request, not that the mailbox received it. Respect your provider's daily allowance when sending announcements.

## Updates and recovery

Keep the same `wrangler.instance.json` and run `npm run deploy` for updates. The helper applies pending database migrations before building and uploading the Worker. Write additive migrations so an older Worker can continue serving during an update. Never edit an applied migration.

When upgrading from the original website-editor version, first copy its saved configuration into `content/wedding.json` and validate it. The new application ignores `settings.wedding`; it does not delete that legacy record or any guest data. Guest-import and email-campaign migrations are additive. Content updates now publish through deployment, while guest replies remain in D1.

Wrangler commands can also be run individually:

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.instance.json
npm run build
npx wrangler deploy
```

The Cloudflare Vite plugin writes a deployment redirect to the compiled Worker. Use `wrangler deploy` after the build; directly deploying the uncompiled `workers/app.ts` will not resolve React Router's virtual server module.

If first-time setup was interrupted, check Cloudflare for the database, email queue, bucket and Worker before creating replacements. To recreate missing secrets, use `wrangler secret put` with a fresh random value; keep an existing `AUTH_SECRET` unless you intentionally want to revoke sessions. Apply migrations before opening the dashboard.

If account creation succeeds but initial role assignment fails, inspect the single user record in D1 and promote that owner's record to `admin` through the Cloudflare dashboard. Do not enable public signup. Normal password recovery is available on the login screen once email is configured.

Attach a custom domain in Cloudflare's Worker settings if desired, then update `APP_ORIGIN`. The template does not require a separate database, authentication, media, analytics or payment-service account.

## Operational limits

- R2 is private. Media is streamed through authenticated Worker endpoints; no public bucket URL is used.
- Uploads are streamed, not buffered as whole files. The 90 MB ceiling stays below the standard 100 MB request-body limit. Browser-supported JPEG/PNG/WebP and MP4/WebM are accepted; HEIC, MOV and SVG are not.
- There is no transcoding, EXIF removal, malware scanning, resumable upload, automatic face recognition or CDN-public album. Hosts review originals and should choose conservative quotas.
- The gallery and moderation screen show the newest 200 files. Large albums need pagination before using this starter at that scale.
- Automatic announcements are not scheduled campaigns; the dashboard queues host-written updates after a preview step. Batches currently cover up to 500 distinct email addresses.
- Resource costs depend mostly on media volume. Configure Cloudflare billing notifications and keep a post-event archive and deletion plan.
- Default `noindex` is a search-engine request, not an access control. Basic wedding information is public; guest records, seating and media require authorization.

Reference: [Cloudflare resource provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning), [React Router on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/), [Resend domains](https://resend.com/docs/dashboard/domains/introduction).
