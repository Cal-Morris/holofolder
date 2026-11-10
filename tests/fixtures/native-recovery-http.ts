import assert from 'node:assert/strict'
async function main() {
// @ts-expect-error Isolated Bun mock, never escapes this subprocess.
const {mock}=await import('bun:test')
mock.module('server-only',()=>({}))
const {storageCommandHarness}=await import('./storage-command-harness')
const {handleNativeRecovery}=await import('../../lib/server/native-recovery-http')
const {POST}=await import('../../app/api/native-recovery/route')
const {client}=storageCommandHarness('synthetic-recovery-http')
const owner='00000000-0000-4000-8000-0000000000e2'
const headers={'Content-Type':'application/json',Origin:'http://localhost:3529','X-Binder-Owner':owner,'X-Binder-Auth-Session':'synthetic-e2e-auth-session'}
const call=(operation:string,input:unknown,extra={})=>handleNativeRecovery(new Request(`http://localhost:3529/app/native-recovery?operation=${operation}`,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(input)}),{session:client,admin:client})
const preview=await call('recovery.preview',{eventId:'101',restoreUnassignedItemIds:[]})
assert.equal(preview.status,200)
const p=(await preview.json()).preview
assert.equal(p.planToken,'a'.repeat(64))
assert.equal(JSON.stringify(p).includes('recovery_state'),false)
assert.equal((await call('recovery.preview',{eventId:'102',restoreUnassignedItemIds:[]})).status,200)
const apply={eventId:'101',restoreUnassignedItemIds:[],operationId:'synthetic-http-recovery',confirmed:true,planVersion:1,planToken:p.planToken}
const a=await call('recovery.apply',apply), b=await call('recovery.apply',apply)
assert.equal(a.status,200);assert.deepEqual(await a.json(),await b.json())
assert.equal((await call('recovery.apply',apply,{'X-Binder-Owner':'foreign-owner'})).status,403)
assert.equal((await call('recovery.apply',apply,{'X-Binder-Auth-Session':'foreign-session'})).status,403)
assert.equal((await call('recovery.apply',apply,{Origin:'https://attacker.test'})).status,403)
assert.equal((await call('recovery.apply',{...apply,operationId:'synthetic-stale-token',planToken:'b'.repeat(64)})).status,409)
assert.equal((await call('slots',apply)).status,400)
assert.equal((await POST()).status,503)
}
void main()
