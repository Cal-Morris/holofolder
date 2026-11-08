# Contributing to Holo Folder

Keep changes focused on one problem. For larger changes, open an issue to agree on scope before implementation. Read [AGENTS.md](AGENTS.md) for architecture, conventions and the project playbooks.

## Local development

Use Bun 1.3.14 (the CI version) and your own Supabase project. Follow [README.md](README.md) and [scripts/MIGRATIONS.md](scripts/MIGRATIONS.md), including the reconstructed `user_settings` table. Never use the hosted Holo Folder database, Stripe account, storage bucket or provider credentials for development.

```sh
bun install --frozen-lockfile
cp .env.example .env.local
bun run dev -p 3287
# Open http://localhost:3287/app
```

Configure the Supabase URL and auth redirect allowlist for your own local URL. Keep the service-role key server-only. Optional integrations need your own credentials; leave them unset until needed. The Framer marketing site is separate from this repository.

## Before opening a pull request

Run the checks relevant to your change. New business logic needs unit tests in `tests/`, using `node:test` and `node:assert/strict`.

```sh
bun run test
bun run typecheck
bun run lint
```

UI changes need the mobile checks in [mobile-ui-verification](.agents/skills/mobile-ui-verification/SKILL.md). Run focused Playwright specs when useful; the full suite is not required for every change. Use your own server port and stop only processes you started.

Describe the problem, the resulting behaviour, what you verified and any limitations. Include migration and configuration requirements. Maintainers handle hosted migrations and deployment; opening a pull request does not authorize access to production services.

## Secrets and test data

Never commit credentials, environment files, database exports, private collection backups, browser traces or screenshots containing personal data. Use synthetic accounts and clearly labelled synthetic card/price fixtures. Do not paste sensitive values into issues, PRs or build logs.

Install [Gitleaks](https://github.com/gitleaks/gitleaks), then run `bun run scan:secrets` after committing locally. This scans the fetched git history, including branches and tags. It does not fetch remote branches/PR refs or inspect uncommitted files. Follow the full publication procedure in [docs/open-source-readiness.md](docs/open-source-readiness.md) before making the repository public.

Report security issues privately using [SECURITY.md](SECURITY.md).

## Third-party material

Keep upstream copyright notices and licenses. Do not add card artwork or other assets without documenting their source and redistribution rights. Code licensing does not grant rights to Pokémon names, card text, artwork or Holo Folder branding. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
