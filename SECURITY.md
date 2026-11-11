# Security

Only the current `main` branch receives security fixes.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Cal-Morris/holofolder/security/advisories/new). If private reporting is unavailable, contact the maintainer through the contact information on their [GitHub profile](https://github.com/Cal-Morris). Do not open a public issue containing vulnerability details or secrets.

Include the affected revision, reproduction steps using synthetic data, expected impact and any proposed fix. Never include real account data, session cookies, API keys, payment information or database connection strings. Do not test against the hosted service or other people's accounts without explicit permission.

## Accidental disclosure

Revoke or rotate an exposed credential first. Deleting it from the latest revision does not remove it from history. Coordinate any history rewrite with the maintainer, including branches, tags, PR refs, forks and other clones. Follow [GitHub's sensitive-data removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

## Maintainer publication checks

Enable private vulnerability reporting and available secret scanning/push protection before accepting public contributions. Review Actions and Vercel settings so untrusted pull requests cannot run with production credentials or privileged deployment access. Keep database exports, raw audit reports and local environment files outside the published repository.
