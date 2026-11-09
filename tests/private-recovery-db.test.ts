import { test } from "node:test"
import assert from "node:assert/strict"
import { privateRecoveryDatabase } from "./private-recovery-db"

test("private recovery database admission rejects URLs and arbitrary sockets", () => {
  const original = { socket: "/synthetic/original/socket", port: 55501, user: "synthetic_test" }
  for (const host of ["postgresql://example.invalid/postgres", "localhost", "/tmp/unknown/socket", ""]) {
    assert.throws(() => privateRecoveryDatabase(host, original))
  }
  assert.deepEqual(privateRecoveryDatabase(original.socket, original), { host: original.socket, port: 55501, user: "synthetic_test", database: "postgres" })
  assert.deepEqual(privateRecoveryDatabase("/Users/cal/.local/share/holofolder/issue396-cascade-local/socket", original), {
    host: "/Users/cal/.local/share/holofolder/issue396-cascade-local/socket", port: 55581, user: "cascade_recovery_test", database: "postgres",
  })
  assert.deepEqual(privateRecoveryDatabase("/Users/cal/.local/share/holofolder/issue396-converted-local/socket", original), {
    host: "/Users/cal/.local/share/holofolder/issue396-converted-local/socket", port: 55580, user: "converted_recovery_test", database: "postgres",
  })
})
