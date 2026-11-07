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
    assert.equal(getMagicLinkRedirectUrl(), "https://example.com/auth/callback")
  })
})

test("adds https:// to bare Vercel hostnames", () => {
  withEnv({ VERCEL_URL: "binderdex-git-x.vercel.app" }, () => {
    assert.equal(getMagicLinkRedirectUrl(), "https://binderdex-git-x.vercel.app/auth/callback")
  })
})

test("prefers the production URL over the per-deployment URL", () => {
  withEnv({ VERCEL_PROJECT_PRODUCTION_URL: "holofolder.com", VERCEL_URL: "binderdex-abc.vercel.app" }, () => {
    assert.equal(getMagicLinkRedirectUrl(), "https://holofolder.com/auth/callback")
  })
})

test("ignores blank values and falls back to localhost outside production", () => {
  withEnv({ NEXT_PUBLIC_SITE_URL: "   ", NODE_ENV: "development" }, () => {
    assert.equal(getMagicLinkRedirectUrl(), "http://localhost:3000/auth/callback")
  })
})

test("falls back to the production site in production", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.equal(getMagicLinkRedirectUrl(), "https://holofolder.com/auth/callback")
  })
})

test("password recovery redirect encodes the recovery path", () => {
  withEnv({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }, () => {
    assert.equal(
      getPasswordRecoveryRedirectUrl(),
      "http://localhost:3000/auth/callback?next=%2Fauth%2Flogin%3Fmode%3Drecovery",
    )
  })
})

test("signed-out visitors to the binder are sent to the landing page", () => {
  assert.equal(getSignedOutRedirectPath("/", false), "/home")
})

test("signed-in visitors and other paths are not redirected", () => {
  assert.equal(getSignedOutRedirectPath("/", true), null)
  for (const pathname of ["/home", "/auth/login", "/app-shell", "/share/abc", "/e2e-harness", "/api/card-prices"]) {
    assert.equal(getSignedOutRedirectPath(pathname, false), null, pathname)
  }
})
