// The admin client also appears in dynamically loaded shared modules. Keep its import graph
// browser-safe; authenticated server entry points install the request-local reader.
let readContext: () => string | undefined = () => undefined
export function installAuditHeaderReader(reader: () => string | undefined) { readContext = reader }
export function readAuditHeader() { return readContext() }
