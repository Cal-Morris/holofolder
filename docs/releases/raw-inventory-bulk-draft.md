# Draft, unpublished: selected raw Inventory copies

Related: #383/#385. Staged preparation only. Native production admission stays closed; do not publish until parent rollout and production verification pass. #383/#385/#379 remain open.

Select individual raw copies across Inventory pages and filters, then review Move or Unassign together. Move pairs each chosen physical copy with a different compatible empty saved slot. Unassign keeps every copy owned and leaves the former slots' targets and wants intact.

The review lists exact copy IDs and before/after locations in selection order. Clear selection removes the whole selection, including copies hidden by filters. No unseen copy is selected automatically. Graded copies remain available to inspect individually; their ownership actions and occupied bulk destinations are outside this slice.

All selected changes fit one existing bounded atomic request or none are queued. A failed or unknown reply retains the original operation and bytes. Sync is confirmed separately using a fresh complete read. The acknowledged operation links to exact Activity history; recovery requires the existing authoritative preview and current permission/version checks. No instant Undo is promised.

REST/MCP composition and help: `content/docs/native-storage.mdx`, `docs/inventory-ownership-actions.md`. No API/registry/OpenAPI, SQL, queue protocol or backend changes. No Framer publication, production enablement or hosted write is included.
