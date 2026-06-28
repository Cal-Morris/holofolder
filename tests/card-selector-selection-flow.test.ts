import test from "node:test"
import assert from "node:assert/strict"
import { completeCardSelectorSelection } from "../lib/card-selector-selection-flow"

test("completeCardSelectorSelection collapses the selector before saving the card selection", () => {
  const events: string[] = []

  completeCardSelectorSelection({
    onClose: () => events.push("close"),
    onSelect: () => events.push("select"),
  })

  assert.deepEqual(events, ["close", "select"])
})
