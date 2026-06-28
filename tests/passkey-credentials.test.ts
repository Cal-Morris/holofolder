import test from "node:test"
import assert from "node:assert/strict"
import { serializePasskeyCredentials } from "../lib/passkey-credentials"

test("serializePasskeyCredentials only exposes settings-safe passkey fields", () => {
  assert.deepEqual(
    serializePasskeyCredentials([
      {
        id: "credential-row-1",
        user_id: "user-1",
        credential_id: "secret-credential-id",
        public_key: "secret-public-key",
        counter: 42,
        device_type: "platform",
        created_at: "2026-06-28T20:00:00.000Z",
      },
      {
        id: "credential-row-2",
        device_type: null,
        created_at: "2026-06-28T21:00:00.000Z",
      },
    ]),
    [
      {
        id: "credential-row-1",
        device_type: "platform",
        created_at: "2026-06-28T20:00:00.000Z",
      },
      {
        id: "credential-row-2",
        device_type: "Passkey",
        created_at: "2026-06-28T21:00:00.000Z",
      },
    ],
  )
})
