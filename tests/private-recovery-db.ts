import assert from "node:assert/strict"

// Explicit local sockets only. Never accept a connection URL or fall back to hosted credentials.
export function privateRecoveryDatabase(socket: string, original: { socket: string; port: number; user: string }) {
  const performance = socket === "/Users/cal/.local/share/holofolder/issue396-perf-local/socket"
  assert.ok(performance || socket === original.socket)
  return { host: socket, port: performance ? 55596 : original.port, user: performance ? "recovery_perf_test" : original.user, database: "postgres" }
}
