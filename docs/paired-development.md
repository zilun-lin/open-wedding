# Develop the template and your wedding together

Keep two neighboring checkouts: the public reusable project and your private wedding repository. Initialize the private repository by cloning the template with its full Git history, rename the template remote to `upstream`, and add the private repository as `origin`. GitHub's template button starts new history; preserving history makes subsequent upstream merges straightforward.

```sh
git clone https://github.com/zilun-lin/open-wedding.git your-wedding
cd your-wedding
git remote rename origin upstream
# Add your newly created private GitHub repository as origin, then push main.
```

## Ownership and extension boundaries

The reusable project owns configuration schemas, feature gates, reusable views, domain behavior, migrations, backend adapters, deployment tooling, documentation and fictional fixtures. Your wedding owns `content/wedding.json`, approved public assets and its presentation choices. Personalize shared CSS/components in your private checkout; keep those commits separate from reusable behavior so upgrades can be reconciled deliberately.

Guest records, mailbox extracts, private source links, invitation codes, credentials, local storage and `wrangler.instance.json` stay ignored even in a private repository. Give each deployment its own instance configuration, database, bucket and queue. Back up ignored instance/provenance files privately; Git does not transfer them.

## Discover a feature in the actual wedding

Prototype in the private wedding when that gives useful feedback. Separate generic behavior from concrete times, wording, assets and contacts before promoting it. For example, shuttle departures, capacity checks and household bookings are reusable; your pickup address, departure times and bus capacity are configuration.

Keep reusable changes in focused commits. Have the agent cherry-pick only those reviewed commits into a feature branch in the public checkout, or port a reviewed diff when the prototype mixed concerns. A cherry-pick copies the selected change without copying the private branch's ancestors. Audit the resulting public diff for wedding-specific material, add fictional examples and test meaningful permissions/data boundaries. Add database migrations instead of rewriting applied ones. Run `npm run verify` before publishing.

After the public feature merges, bring it into your private checkout:

```sh
git fetch upstream
git merge upstream/main
npm ci
npm run verify
```

Resolve configuration and presentation conflicts while preserving your wedding's content. If a feature was prototyped privately, reconcile its earlier implementation with the merged upstream version. Review pending migrations before deployment. Use the same deployment resources so existing replies/uploads survive.

Only reviewed generic commits flow to the public repository. Do not push or merge your private wedding branch into it. Do not automate bidirectional repository synchronization.

## Agent brief

> Work across these two checkouts. Keep reusable capabilities in the public project and our content/design in the private wedding. When a real wedding need suggests a reusable feature, prototype it, separate configuration from behavior, add fictional examples and prepare a focused upstream change. Keep commits separate and private materials out of Git. Add extension points for actual needs; avoid packaging or abstractions solely for hypothetical users.

## Fixtures and initial launch

Integration tests and demo mode use the stable fictional `examples/wedding.json`, independently of `content/wedding.json`. The CLI's `--config examples/wedding.json` flag is for fictional offline/demo tooling; production APIs always validate against deployed content. `npm run config:check` validates your actual wedding.

Use `publication: "coming-soon"` while details are unconfirmed. It publishes only the announcement fields and closes guest operations. Review the full configuration before changing it to `"published"` and deploying. A local demo is not a production guest import.
