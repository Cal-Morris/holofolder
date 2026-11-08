import {test} from 'node:test'
import {execFileSync} from 'node:child_process'
test('delegated operations reuse verified identity and keep database round trips bounded',()=>{
 execFileSync(process.execPath,[new URL('./fixtures/developer-operation-round-trips.ts',import.meta.url).pathname],{stdio:'pipe'})
})
