import {test} from 'node:test'
import {execFileSync} from 'node:child_process'
test('native recovery reuses trusted bridge, safe projection, current session and fixed public denial',()=>{
  execFileSync(process.execPath,[new URL('./fixtures/native-recovery-http.ts',import.meta.url).pathname],{stdio:'pipe'})
})
