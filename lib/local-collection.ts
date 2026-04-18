const LOCAL_COLLECTED_KEY = "pokemon_collected"

export function readLocalCollectedIds(): number[] {
  if (typeof window === "undefined") return []

  try {
    const stored = window.localStorage.getItem(LOCAL_COLLECTED_KEY)
    if (!stored) return []

    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []

    return Array.from(
      new Set(
        parsed
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    ).sort((a, b) => a - b)
  } catch {
    return []
  }
}

export function writeLocalCollectedIds(ids: number[]) {
  if (typeof window === "undefined") return

  const normalized = Array.from(
    new Set(ids.filter((value) => Number.isInteger(value) && value > 0))
  ).sort((a, b) => a - b)

  window.localStorage.setItem(LOCAL_COLLECTED_KEY, JSON.stringify(normalized))
}

export function addLocalCollectedId(id: number) {
  const ids = new Set(readLocalCollectedIds())
  ids.add(id)
  writeLocalCollectedIds(Array.from(ids))
}

export function removeLocalCollectedId(id: number) {
  const ids = new Set(readLocalCollectedIds())
  ids.delete(id)
  writeLocalCollectedIds(Array.from(ids))
}

export function getLocalCollectedKey() {
  return LOCAL_COLLECTED_KEY
}
