import { test } from "node:test"
import assert from "node:assert/strict"
import { activeBinderEffects } from "../lib/binder-effects"
import { getDefaultBinderSettings } from "../lib/settings"

test("covered and inactive binders pause effects without changing the saved preferences", () => {
  const settings = getDefaultBinderSettings()
  for (const view of ["list", "wanted", "sets", "analytics"]) {
    const active = activeBinderEffects(settings, { view, searchOpen: false, quickModeOpen: false })
    assert.equal(active.cardFinishEffectsEnabled, false)
    assert.equal(active.binderSlotGlareEnabled, false)
  }
  for (const overlay of [{ searchOpen: true, quickModeOpen: false }, { searchOpen: false, quickModeOpen: true }]) {
    const active = activeBinderEffects(settings, { view: "binder", ...overlay })
    assert.equal(active.cardFinishEffectsEnabled, false)
    assert.equal(active.binderSlotGlareEnabled, false)
  }
  assert.equal(settings.cardFinishEffectsEnabled, true)
  assert.equal(settings.binderSlotGlareEnabled, true)
  assert.equal(activeBinderEffects(settings, { view: "binder", searchOpen: false, quickModeOpen: false }), settings)
})
