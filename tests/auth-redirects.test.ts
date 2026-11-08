import test from "node:test"
import assert from "node:assert/strict"
import { getMagicLinkRedirectUrl, getPasswordRecoveryRedirectUrl, getSignedOutRedirectPath } from "../lib/auth-redirects"

const ENV_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_VERCEL_URL",
  "VERCEL_URL",
  "NODE_ENV",
] as const

function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, run: () => void) {
  const env = process.env as Record<string, string | undefined>
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]))
  try {
    for (const key of ENV_KEYS) {
      if (key === "NODE_ENV") continue
      delete env[key]
    }
    for (const [key, value] of Object.entries(values)) {
      env[key] = value
    }
    run()
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete env[key]
      else env[key] = saved[key]
    }
  }
}

test("uses NEXT_PUBLIC_SITE_URL first and strips a trailing slash", () => {
  withEnv({ NEXT_PUBLIC_SITE_URL: "https://example.com/", VERCEL_URL: "preview.vercel.app" }, () => {
    assert.equal(getMagicLinkRedirectUrl(), "https://example.com/app/auth/callback")
  })
})

test("adds https:// to bare Vercel hostnames", () => {
  withEnv({ VERCEL_URL: "binderdex-git-x.vercel.app" }, () => {
    assert.equal(getMagicLinkRedirectUrl(), "https://binderdex-git-x.vercel.app/app/auth/callback")
  })
})

test("prefers the production URL over the per-deployment URL", () => {
  withEnv({ VERCEL_PROJECT_PRODUCTION_URL: "holofolder.com", VERCEL_URL: "binderdex-abc.vercel.app" }, () => {
    assert.equal(getMagicLinkRedirectUrl(), "https://holofolder.com/app/auth/callback")
  })
})

test("ignores blank values and falls back to localhost outside production", () => {
  withEnv({ NEXT_PUBLIC_SITE_URL: "   ", NODE_ENV: "development" }, () => {
    assert.equal(getMagicLinkRedirectUrl(), "http://localhost:3000/app/auth/callback")
  })
})

test("uses the public Framer origin as the production fallback", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.equal(getMagicLinkRedirectUrl(), "https://holofolder.com/app/auth/callback")
  })
})

test("password recovery redirect encodes the recovery path", () => {
  withEnv({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }, () => {
    assert.equal(
      getPasswordRecoveryRedirectUrl(),
      "http://localhost:3000/app/auth/callback?next=%2Fapp%2Fauth%2Flogin%3Fmode%3Drecovery",
    )
  })
})

test("signed-out visitors to the binder are sent to sign-in", () => {
  assert.equal(getSignedOutRedirectPath("/", false), "/auth/login")
})

test("signed-in visitors and other paths are not redirected", () => {
  assert.equal(getSignedOutRedirectPath("/", true), null)
  for (const pathname of ["/home", "/auth/login", "/app-shell", "/share/abc", "/e2e-harness", "/api/card-prices"]) {
    assert.equal(getSignedOutRedirectPath(pathname, false), null, pathname)
  }
})

test("configured site URL may already include /app", () => {
  withEnv({ NEXT_PUBLIC_SITE_URL: "https://holofolder.com/app" }, () => {
    assert.equal(getMagicLinkRedirectUrl(), "https://holofolder.com/app/auth/callback")
  })
})

test("proxy auth redirects keep the public origin and app prefix", async () => {
  const { appRedirectUrl } = await import("../lib/auth-redirects")
  assert.equal(appRedirectUrl("/auth/error", "https://app.holofolder.com/app/auth/callback").href, "https://holofolder.com/app/auth/error")
  assert.equal(appRedirectUrl(null, "http://localhost:3295/app/auth/callback").href, "http://localhost:3295/app")
  assert.equal(appRedirectUrl("//evil.example", "https://holofolder.com/app/auth/callback").href, "https://holofolder.com/app")
})

test('docs sign-in can return to the key guide without allowing external redirect targets', () => {
  withEnv({ NEXT_PUBLIC_SITE_URL: 'https://holofolder.com' }, () => {
    assert.equal(getMagicLinkRedirectUrl('/app/docs/api-keys'), 'https://holofolder.com/app/auth/callback?next=%2Fapp%2Fdocs%2Fapi-keys')
    assert.equal(getMagicLinkRedirectUrl('https://untrusted.example/'), 'https://holofolder.com/app/auth/callback?next=%2Fapp')
  })
})
