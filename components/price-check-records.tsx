"use client"

import { ChevronDown } from "lucide-react"
import { useState } from "react"
import { formatGbpAmount } from "@/lib/price-format"
import type { CardPriceCheck, CardPriceChecks, PriceCheckSource } from "@/lib/card-price-checks"

export function PriceCheckRecords({ checks }: { checks: CardPriceChecks | undefined }) {
  if (!checks) return null
  return <div className="mt-1 text-xs">
    {checks.ebay?.searchUrl ? <a href={checks.ebay.searchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center font-semibold underline">View listings on eBay ↗</a> : null}
    {(["soldcomps", "ebay"] as const).map(source => checks[source] ? <SourceRecords key={`${source}:${checks[source]!.checkedAt}`} check={checks[source]!} source={source} /> : null)}
  </div>
}

function SourceRecords({ check, source }: { check: CardPriceCheck; source: PriceCheckSource }) {
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(10)
  const sold = source === "soldcomps"
  const records = sold ? check.sales : check.listings
  const sorted = [...(records ?? [])].sort((left, right) => {
    if ("soldAt" in left && "soldAt" in right && typeof left.soldAt === "string" && typeof right.soldAt === "string") return right.soldAt.localeCompare(left.soldAt)
    return left.amount - right.amount
  })
  return <details className="group" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="flex min-h-9 cursor-pointer items-center font-semibold">{sold ? "Sold records" : "Asking records"} · {check.summary.count}<ChevronDown className="ml-1 h-3 w-3 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
    {open ? <div className="space-y-2 pb-2">
      <p className="text-muted-foreground">{sold ? "Sold on eBay · supplied by SaleHistory / soldcomps.io" : "Listed on eBay · supplied by eBay Browse API"}. Saved {new Date(check.checkedAt).toLocaleString("en-GB")}.</p>
      {sorted.length ? <>
        <ol className="space-y-2" aria-label={sold ? "Matched sold records" : "Matched asking records"}>
          {sorted.slice(0, visible).map((record, index) => <li key={index} className="rounded-lg border border-border/50 p-2">
            <p className="flex flex-wrap justify-between gap-x-2 font-semibold"><span>{formatGbpAmount(record.amount)}</span>{"soldAt" in record && typeof record.soldAt === "string" ? <time dateTime={record.soldAt}>{record.soldAt}</time> : <span>Asking snapshot</span>}</p>
            {record.title ? <p className="break-words">{record.title}</p> : <p className="text-muted-foreground">Listing title was not saved with this older check.</p>}
            <p className="text-muted-foreground">{record.condition ?? "Condition not supplied"}</p>
            {record.url ? <a href={record.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center underline">Verify {sold ? "sale" : "listing"} on eBay ↗</a> : <p className="text-muted-foreground">No listing link saved.</p>}
          </li>)}
        </ol>
        {sorted.length > visible ? <button type="button" className="min-h-9 underline" onClick={() => setVisible(count => count + 10)}>Show more records ({sorted.length - visible} remaining)</button> : null}
      </> : <p className="text-muted-foreground">{check.summary.count ? "This older check saved a summary only. Listing details will appear after the next fresh manual check." : "No matched records in this sample."}</p>}
      <p className="text-muted-foreground">Matched sample only. Postage excluded. Old eBay listings may no longer be available.</p>
    </div> : null}
  </details>
}
