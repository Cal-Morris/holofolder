import test from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_BINDER_COLOR_ID } from "../lib/binder-colors"
import {
  DEFAULT_BINDER_SETTINGS,
  normalizeBinderSettings,
  settingsFromRow,
  settingsToRow,
  type BinderSettings,
} from "../lib/settings"

const custom: BinderSettings = {
  binderRows: 3,
  binderCols: 3,
  binderColorId: DEFAULT_BINDER_COLOR_ID,
  binderPageColors: { "2": DEFAULT_BINDER_COLOR_ID },
  binderSlotGlareEnabled: false,
  cardFinishEffectsEnabled: false,
  darkMode: false,
}

test("settingsFromRow returns the defaults for a missing row", () => {
  assert.deepEqual(settingsFromRow(null), DEFAULT_BINDER_SETTINGS)
  assert.deepEqual(settingsFromRow(undefined), DEFAULT_BINDER_SETTINGS)
  assert.deepEqual(settingsFromRow({}), DEFAULT_BINDER_SETTINGS)
})

test("settingsFromRow treats null columns as defaults", () => {
  assert.deepEqual(settingsFromRow({
    binder_rows: null,
    binder_cols: null,
    binder_color_id: null,
    binder_page_colors: null,
    binder_slot_glare_enabled: null,
    card_finish_effects_enabled: null,
    dark_mode: null,
  }), DEFAULT_BINDER_SETTINGS)
})

test("settingsFromRow rejects zero, negative and non-finite grid sizes", () => {
  for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    const settings = settingsFromRow({ binder_rows: bad, binder_cols: bad })
    assert.equal(settings.binderRows, 4)
    assert.equal(settings.binderCols, 4)
  }
})

test("settingsToRow and settingsFromRow round-trip", () => {
  assert.deepEqual(settingsFromRow(settingsToRow(custom)), custom)
  assert.deepEqual(settingsToRow(custom), {
    binder_rows: 3,
    binder_cols: 3,
    binder_color_id: DEFAULT_BINDER_COLOR_ID,
    binder_page_colors: { "2": DEFAULT_BINDER_COLOR_ID },
    binder_slot_glare_enabled: false,
    card_finish_effects_enabled: false,
    dark_mode: false,
  })
})

test("settingsFromRow does not share the default page colour object", () => {
  const first = settingsFromRow(null)
  first.binderPageColors["1"] = DEFAULT_BINDER_COLOR_ID
  assert.deepEqual(settingsFromRow(null).binderPageColors, {})
})

test("normalizeBinderSettings supports legacy rows/cols and falls back on invalid values", () => {
  assert.equal(normalizeBinderSettings({ rows: 3, cols: 2 }, custom).binderRows, 3)
  assert.equal(normalizeBinderSettings({ rows: 3, cols: 2 }, custom).binderCols, 2)
  assert.equal(normalizeBinderSettings({ binderRows: 5, rows: 3 }, custom).binderRows, 5)
  assert.equal(normalizeBinderSettings({ binderRows: 0, binderCols: Number.NaN }, custom).binderRows, 3)
  assert.equal(normalizeBinderSettings({ binderRows: 0, binderCols: Number.NaN }, custom).binderCols, 3)
  assert.equal(normalizeBinderSettings({ darkMode: true }, custom).darkMode, true)
  assert.equal(normalizeBinderSettings(null, custom), custom)
})
