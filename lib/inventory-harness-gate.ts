/** Local synthetic test surface only, including local production-mode test builds. */
export function canShowInventoryHarness(enabled: string | undefined, hosted: boolean, host: string | null) {
  return enabled === '1' && !hosted && host !== null && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
}
