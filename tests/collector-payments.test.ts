import { test } from "node:test"
import assert from "node:assert/strict"
import type Stripe from "stripe"
import { verifiedCollectorInvoices } from "../lib/collector-payments"
const invoice = (id: string, paidAt: number, overrides = {}) => ({ id, status: "paid", currency: "gbp", amount_paid: 399, billing_reason: "subscription_cycle", parent: { subscription_details: { subscription: "sub_synthetic" } }, status_transitions: { paid_at: paidAt }, lines: { data: [{ amount: 399, pricing: { price_details: { price: "price_synthetic" } }, period: { start: paidAt, end: paidAt + 1000 } }], has_more: false }, ...overrides }) as unknown as Stripe.Invoice
test("first payment follows verified history, not webhook arrival order", () => {
  const results = verifiedCollectorInvoices([invoice("in_later",200),invoice("in_first",100)],new Set(["sub_synthetic"]),["price_synthetic"])
  assert.deepEqual(results.map(row => row.invoiceId),["in_first","in_later"])
  assert.equal(results[0].at,new Date(100000).toISOString())
})
test("trial, zero, unpaid, other-product and incomplete invoices cannot count as conversion", () => {
  for (const overrides of [{amount_paid:0},{currency:"usd"},{status:"open"},{parent:null},{lines:{data:[{amount:399,pricing:{price_details:{price:"price_unrelated"}},period:{start:100,end:200}}],has_more:false}}]) assert.deepEqual(verifiedCollectorInvoices([invoice("in_invalid",100,overrides)],new Set(["sub_synthetic"]),["price_synthetic"]),[])
  assert.throws(()=>verifiedCollectorInvoices([invoice("in_partial",100,{lines:{data:[],has_more:true}})],new Set(["sub_synthetic"]),["price_synthetic"]),/incomplete/i)
})
