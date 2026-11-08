# OAuth compatibility evidence

Baseline: `f1ff994`, 2026-11-08. Unit baseline: 1086 pass, 0 fail.

Hosted Auth discovery currently returns HTTP 404, `feature_disabled`, `OAuth server is disabled`. No existing public-schema access-token hook was found. OAuth has not been enabled by this change.

Hosted schema has `auth.oauth_clients`, `auth.oauth_authorizations`, `auth.oauth_consents` and `auth.sessions.oauth_client_id`, with session identity and creation/expiry fields. Current Supabase documentation supports a token hook for a client-specific audience and role, OAuth client registration and user grant revocation.

Planned boundary: issue OAuth tokens with the MCP audience and a dedicated unprivileged role; enforce a verified active OAuth session and user/client grant on every tool call. Revocation and reauthorization must invalidate earlier session ids, including old JWTs and refresh attempts. Real issuance/resource-binding/refresh proof remains pending while hosted OAuth is disabled. No generic login JWT is acceptable as an MCP token.

Before enabling: prove the hook, direct database/RPC/Storage/Realtime denial, first-party behavior, advertised discovery, consent and real client connection. Test fixtures and rolled-back schema simulation are separate evidence from real OAuth issuance.

## Hosted proof passed

After applying migrations 059, 060 and 061, verified with a temporary registered OAuth client and synthetic account:

- Normal first-party sign-in kept `aud=authenticated` and `role=authenticated`.
- OAuth authorization redirected to `/app/oauth/consent`, matching the current Site URL plus `/oauth/consent` authorization path.
- Authorization code + S256 PKCE exchange produced the exact MCP audience, isolated `holo_mcp` role and the active application grant id.
- The signature verifier and active-session/grant RPC accepted the issued token.
- Direct PostgREST collection access with that token returned 403.
- Refresh retained valid MCP access.
- Revocation denied both the original and refreshed access tokens.
- Reauthorization permitted the new token while both old tokens remained denied.

The synthetic client/account were deleted and the original OAuth/hook configuration restored. OAuth is still disabled for public onboarding until release. Real client transport, browser consent, Storage/Realtime bypass checks and production routing remain separate release checks.

Operational finding: the installed Supabase SDK's admin OAuth client-list types do not match the hosted empty-list response. The proof checks the registered-client count through the hosted auth schema before creating fixtures, rather than assuming that response shape.


Additional hosted verification: the actual MCP SDK2.4 Streamable HTTP client initialized against the common HTTP handler, listed tools, read languages, created a binder and replayed the same idempotency key without duplication, and denied an ungranted settings write. REST keys were rejected by MCP with an advertised protected-resource metadata URL, and OAuth tokens were rejected by REST. The same run proved signup trials denied, lifetime access allowed, expired/revoked keys denied, >1000 Pokédex pagination, direct private Storage denial, refresh and old-token denial after revoke/reapprove. Synthetic users/clients were removed and OAuth settings restored. Next.js deployed routing and production issuance remain separate release gates.
