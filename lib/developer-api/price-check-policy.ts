/** Only the signed-in app may initiate paid sold-comps work. Saved evidence stays readable. */
export function requiresPriceCheckUi(operation: string, input: Record<string, unknown>): boolean {
  return operation === 'start_comparison_job' || (operation === 'refresh_price_checks' && input.source !== 'ebay');
}
