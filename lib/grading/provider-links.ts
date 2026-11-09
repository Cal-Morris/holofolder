import type { GradingRecord } from "@/lib/domain/inventory"

// Official source evidence and access limits: docs/manual-grading.md.
export const GRADING_PROVIDERS = {
  psa: { name: "PSA", lookup: "https://www.psacard.com/cert" },
  ace: { name: "ACE", lookup: "https://acegrading.com/cert" },
  cgc: { name: "CGC", lookup: "https://www.cgccards.com/certlookup/" },
  beckett: { name: "Beckett", lookup: "https://beckett.com/grading/card-lookup" },
} as const satisfies Record<Extract<GradingRecord["provider"], { kind: "known" }>["id"], { name: string; lookup: string }>

/** Only the observed PSA trading-card shape is supported. Never fetches a record. */
export function parseOfficialGradingUrl(input: string): { provider: GradingRecord["provider"]; certificate: string } | null {
  // Reject URL-parser repairs, credentials, encoded paths and nonstandard ports.
  if (!/^https:\/\/(?:www\.)?psacard\.com\/cert\/[0-9]{8,9}\/psa\/?(?:[?#].*)?$/.test(input)) return null
  const url = new URL(input)
  const certificate = /^\/cert\/([0-9]{8,9})\/psa\/?$/.exec(url.pathname)?.[1]
  return certificate ? { provider: { kind: "known", id: "psa" }, certificate } : null
}

export function privateGradingLink(record: GradingRecord | null) {
  if (!record || record.provider.kind !== "known" || !record.certificate) return null
  const provider = GRADING_PROVIDERS[record.provider.id]
  if (record.provider.id === "psa" && /^[0-9]{8,9}$/.test(record.certificate)) {
    return { name: provider.name, kind: "record" as const, href: `https://www.psacard.com/cert/${record.certificate}/psa` }
  }
  return { name: provider.name, kind: "lookup" as const, href: provider.lookup }
}
