import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
  crons: Array<{ path: string; schedule: string }>
}

// Hobby projects reject (and silently skip deploying) any cron that runs more than once a day.
test("every cron runs at most once a day so Hobby deploys are not blocked", () => {
  for (const { schedule } of config.crons) {
    const [minute, hour] = schedule.split(" ")
    assert.match(minute, /^\d+$/, schedule)
    assert.match(hour, /^\d+$/, schedule)
  }
})

test("scheduled price refresh fires every three hours via one daily cron per slot", () => {
  const hours = config.crons
    .filter(cron => cron.path === "/app/api/card-prices/refresh")
    .map(cron => Number(cron.schedule.split(" ")[1]))
    .sort((a, b) => a - b)
  assert.deepEqual(hours, [0, 3, 6, 9, 12, 15, 18, 21])
})
