"use client"

import { useState } from "react"
import type { GradingRecord } from "@/lib/domain/inventory"
import { privateGradingLink } from "@/lib/grading/provider-links"

/** Private owner details only. Never mount in a public share or serialize this record into one. */
export default function ProviderRecordLink({ record }: { record: GradingRecord | null }) {
  const [notice, setNotice] = useState("")
  const link = privateGradingLink(record)
  if (!record?.certificate) return null
  return <section aria-label="Private certificate">
    <p>Certificate: <span style={{ overflowWrap: "anywhere" }}>{record.certificate}</span></p>
    {link && <a href={link.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      {link.kind === "record" ? `View on ${link.name}` : `Open ${link.name} lookup page`}
    </a>}
    <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(record.certificate!); setNotice("Certificate copied") }
      catch { setNotice("Copy unavailable. Select the certificate text to copy it.") }
    }}>Copy certificate number</button>
    <p>{link?.kind === "lookup" ? "Lookup-page fallback. Paste the copied certificate on the official site. " : ""}External lookup needs a connection. These details are user-recorded, not authenticated.</p>
    <p role="status">{notice}</p>
  </section>
}
