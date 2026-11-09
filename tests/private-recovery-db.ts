import assert from "node:assert/strict"

// Explicit local sockets only. Never accept a connection URL or fall back to hosted credentials.
export function privateRecoveryDatabase(socket: string, original: { socket: string; port: number; user: string }) {
  const performance = socket === "/Users/cal/.local/share/holofolder/issue396-perf-local/socket"
  const converted = socket === "/Users/cal/.local/share/holofolder/issue396-converted-local/socket"
  assert.ok(performance || converted || socket === original.socket)
  if (converted) return { host: socket, port: 55580, user: "converted_recovery_test", database: "postgres" }
  return { host: socket, port: performance ? 55596 : original.port, user: performance ? "recovery_perf_test" : original.user, database: "postgres" }
}
