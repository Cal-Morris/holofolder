import {test} from 'node:test'
import {execFileSync} from 'node:child_process'
test('Activity recovery authenticates first-party writes, binds owner and redacts receipts',()=>{
 execFileSync(process.execPath,[new URL('./fixtures/first-party-recovery.ts',import.meta.url).pathname],{stdio:'pipe'})
})
