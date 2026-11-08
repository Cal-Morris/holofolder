# OAuth compatibility evidence

Baseline: `f1ff994`, 2026-11-08. Unit baseline: 1086 pass, 0 fail.

Hosted Auth discovery currently returns HTTP 404, `feature_disabled`, `OAuth server is disabled`. No existing public-schema access-token hook was found. OAuth has not been enabled by this change.

Hosted schema has `auth.oauth_clients`, `auth.oauth_authorizations`, `auth.oauth_consents` and `auth.sessions.oauth_client_id`, with session identity and creation/expiry fields. Current Supabase documentation supports a token hook for a client-specific audience and role, OAuth client registration and user grant revocation.

Planned boundary: issue OAuth tokens with the MCP audience and a dedicated unprivileged role; enforce a verified active OAuth session and user/client grant on every tool call. Revocation and reauthorization must invalidate earlier session ids, including old JWTs and refresh attempts. Real issuance/resource-binding/refresh proof remains pending while hosted OAuth is disabled. No generic login JWT is acceptable as an MCP token.

Before enabling: prove the hook, direct database/RPC/Storage/Realtime denial, first-party behavior, advertised discovery, consent and real client connection. Test fixtures and rolled-back schema simulation are separate evidence from real OAuth issuance.
