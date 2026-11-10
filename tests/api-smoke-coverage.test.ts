import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEVELOPER_OPERATIONS } from '@/lib/developer-api/operations'
import { apiSmokeExitCode, summarizeApiSmokeCoverage, type ApiPerformanceSample } from '@/lib/developer-api/performance-checks'

const samples: ApiPerformanceSample[] = DEVELOPER_OPERATIONS.map(op => ({ operation: op.name, phase: 'first',
  status: op.name === 'start_comparison_job' ? 403 : 200, expectedStatus: op.name === 'start_comparison_job' ? 403 : 200,
  assertionsPassed: true, clientMs: 100, serverMs: 10, authMs: null, operationMs: null, bytes: 1 }))

test('coverage requires actual successful assertions for every admitted operation', () => {
  assert.ok(DEVELOPER_OPERATIONS.every(op => !op.admission))
  assert.ok(summarizeApiSmokeCoverage(samples).every(row => row.successVerified && !row.stagedDenialVerified))
  assert.equal(apiSmokeExitCode(samples, [], { users: true, artwork: [] }), 0)
  for (const name of ['list_cards', 'execute_inventory_commands', 'create_storage_collection', 'list_storage_presets']) {
    assert.equal(apiSmokeExitCode(samples.filter(s => s.operation !== name), [], { users: true, artwork: [] }), 1)
    for (const change of [{ assertionsPassed: false }, { assertionsPassed: undefined }, { status: 503, expectedStatus: 503, scenario: 'native-staged' }]) {
      assert.equal(apiSmokeExitCode(samples.map(s => s.operation === name ? { ...s, ...change } : s), [], { users: true, artwork: [] }), 1)
    }
  }
  assert.equal(apiSmokeExitCode(samples, [], { users: false, artwork: [] }), 1)
  assert.equal(apiSmokeExitCode(samples, ['failed'], { users: true, artwork: [] }), 1)
  assert.equal(apiSmokeExitCode(samples, [], { users: true, artwork: ['synthetic'] }), 2)
})
