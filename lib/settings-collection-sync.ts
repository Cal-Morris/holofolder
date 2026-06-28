interface SettingsLocalCollectedCountInput {
  isSignedIn: boolean
  cloudCollectedCount: number
  localCollectedCount: number
  localPendingSyncCount: number
}

export function getSettingsLocalCollectedCount(input: SettingsLocalCollectedCountInput) {
  if (input.isSignedIn && input.localPendingSyncCount === 0) {
    return input.cloudCollectedCount
  }

  return input.localCollectedCount
}
