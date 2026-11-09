import {test} from 'node:test'
import {execFileSync} from 'node:child_process'
test('MCP HTTP lists and dispatches Activity recovery with OAuth scope checks and trusted attribution',()=>{
 execFileSync(process.execPath,[new URL('./fixtures/activity-mcp.ts',import.meta.url).pathname],{stdio:'pipe'})
})
