import {test} from 'node:test'
import {execFileSync} from 'node:child_process'
test('first-party edit metadata identifies the committed row transaction without reusing audit IDs',()=>{
 execFileSync(process.execPath,[new URL('./fixtures/collection-write-activity.ts',import.meta.url).pathname],{stdio:'pipe'})
})
