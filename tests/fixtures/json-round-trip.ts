/** Sends a value through JSON, as storage, REST and MCP do: brands, prototypes and `undefined` fields are dropped. */
export function jsonRoundTrip<T>(value: T): T {
  // oxlint-disable-next-line react-doctor/no-json-parse-stringify-clone -- the JSON wire format is what these tests check; structuredClone keeps what JSON drops.
  return JSON.parse(JSON.stringify(value));
}
