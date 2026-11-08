# Passkeys

Signed-in users can add a passkey in **Settings → Account → Passkeys**, then use **Sign in with a passkey** on the sign-in page or sign-in dialog. Account settings list registered passkeys and require an inline confirmation before removing one. Email and password sign-in remain available for recovery.

The browser client opts into Supabase Auth's experimental passkey API. The installed `@supabase/supabase-js` version supports `registerPasskey`, `signInWithPasskey` and `auth.passkey.list/delete`; no separate credentials table or WebAuthn server is needed. Supabase verifies the challenge and issues the normal session, persisted through the existing SSR cookie storage.

Production Supabase passkeys are enabled, with relying party ID `holofolder.com`. The public app runs at `https://holofolder.com/app`. Keep this relying party stable: credentials registered for it do not work on `binder.cal.gg`, unrelated preview domains or localhost. Those hosts can still use email or password. Preview tests use a synthetic `localhost` relying party and virtual authenticators, never production credentials.

Registration requires a confirmed, signed-in account, a secure context, a browser with WebAuthn support and an internet connection. Unsupported browsers retain email/password sign-in. Managing passkeys is disabled offline. Closing the relevant UI aborts an outstanding registration or sign-in ceremony.

The focused Playwright spec `e2e/passkeys.e2e.ts` exercises registration, listing, removal, offline controls, cancelled sign-in and successful sign-in/session persistence across all six mobile browser/PWA projects. Backend responses are synthetic; the browser performs WebAuthn ceremonies with Chromium virtual authenticators. Physical-device biometrics and password-manager sync require a real-device check.
