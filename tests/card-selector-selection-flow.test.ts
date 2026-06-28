import test from "node:test"
import assert from "node:assert/strict"
import {
  beginBinderCardSelection,
  completeCardSelectorSelection,
} from "../lib/card-selector-selection-flow"

test("completeCardSelectorSelection collapses the selector before saving the card selection", () => {
  const events: string[] = []

  completeCardSelectorSelection({
    onClose: () => events.push("close"),
    onSelect: () => events.push("select"),
  })

  assert.deepEqual(events, ["close", "select"])
})

test("beginBinderCardSelection collapses selector and selected slot before saving", () => {
  const events: string[] = []

  beginBinderCardSelection({
    onCloseSelector: () => events.push("close-selector"),
    onCloseSelectedSlot: () => events.push("close-slot"),
  })

  assert.deepEqual(events, ["close-selector", "close-slot"])
})
