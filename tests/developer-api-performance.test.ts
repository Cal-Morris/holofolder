import {test} from 'node:test'
import {execFileSync} from 'node:child_process'
test('REST uses one live authorization RPC and batches image availability without storage requests',()=>{
 execFileSync(process.execPath,[new URL('./fixtures/developer-api-performance.ts',import.meta.url).pathname],{stdio:'pipe'})
})
