import {test,expect,SUPABASE_URL} from './fixtures'
test.use({signedIn:true})
test('personal API keys are shown once and revocable, and MCP connections disconnect separately',async({harness})=>{
 const {page}=harness
 await page.route(`${SUPABASE_URL}/auth/v1/passkeys**`,route=>route.fulfill({json:[]}))
 const keyId='00000000-0000-4000-8000-000000000055'
 const syntheticSecret=`hf_${keyId}.${'s'.repeat(43)}`
 let exists=false,connected=true
 await page.route('**/app/api/developer/keys',async route=>{
  if(route.request().method()==='POST') {
   const input=route.request().postDataJSON()
   expect(input.permissions.every((p:string)=>p.endsWith(':read'))).toBe(true)
   exists=true
   await route.fulfill({json:{key:syntheticSecret}});return
  }
  if(route.request().method()==='DELETE'){exists=false;await route.fulfill({json:{revoked:true}});return}
  await route.fulfill({json:{canCreate:true,keys:exists?[{id:keyId,name:'Synthetic script',permissions:['catalog:read'],created_at:'2026-11-08T00:00:00Z',expires_at:'2027-02-06T00:00:00Z'}]:[]}})
 })
 await page.route('**/app/api/developer/clients',async route=>{
  if(route.request().method()==='DELETE'){connected=false;await route.fulfill({json:{revoked:true}});return}
  await route.fulfill({json:{clients:connected?[{id:'synthetic-grant',client_id:'synthetic-client',client_name:'Synthetic MCP client',permissions:['catalog:read'],created_at:'2026-11-08T00:00:00Z'}]:[]}})
 })
 await page.getByRole('button',{name:'More',exact:true}).click()
 await page.getByRole('menuitem',{name:'Settings',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Settings'})
 await dialog.getByRole('button',{name:'Account',exact:true}).click()
 const developer=dialog.getByRole('region',{name:'Developer access'})
 await developer.getByRole('textbox',{name:'Key name'}).fill('Synthetic script')
 await developer.getByRole('button',{name:'Create API key',exact:true}).click()
 await expect(developer.getByText(syntheticSecret,{exact:true})).toBeVisible()
 await developer.getByRole('button',{name:'Hide key',exact:true}).click()
 await expect(developer.getByText(syntheticSecret,{exact:true})).toHaveCount(0)
 const revoke=developer.getByRole('button',{name:'Revoke Synthetic script'})
 await revoke.scrollIntoViewIfNeeded();await harness.expectMinTapTarget(revoke);await revoke.click()
 await expect(developer.getByRole('button',{name:'Revoke Synthetic script'})).toHaveCount(0)
 const disconnect=developer.getByRole('button',{name:'Disconnect Synthetic MCP client'})
 await disconnect.scrollIntoViewIfNeeded();await harness.expectMinTapTarget(disconnect);await disconnect.click()
 await expect(disconnect).toHaveCount(0)
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('an interrupted MCP disconnect stays retryable after reopening Settings',async({harness})=>{
 const {page}=harness
 await page.route(`${SUPABASE_URL}/auth/v1/passkeys**`,route=>route.fulfill({json:[]}))
 await page.route('**/app/api/developer/keys',route=>route.fulfill({json:{keys:[],canCreate:false}}))
 let pending=true,attempts=0
 await page.route('**/app/api/developer/clients',async route=>{
  if(route.request().method()==='DELETE') {
   attempts++
   if(attempts===1){await route.fulfill({status:503,json:{error:{message:'Synthetic interrupted disconnection, retry in Settings.'}}});return}
   pending=false;await route.fulfill({json:{revoked:true}});return
  }
  await route.fulfill({json:{clients:pending?[{client_id:'00000000-0000-4000-8000-000000000099',client_name:'Synthetic interrupted client',revocationPending:true}]:[]}})
 })
 async function openAccount() {
  await page.getByRole('button',{name:'More',exact:true}).click()
  await page.getByRole('menuitem',{name:'Settings',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Settings'})
  await dialog.getByRole('button',{name:'Account',exact:true}).click()
  return dialog
 }
 let dialog=await openAccount()
 await dialog.getByRole('button',{name:'Finish disconnecting Synthetic interrupted client'}).click()
 await expect(dialog.getByRole('alert').filter({hasText:'Synthetic interrupted disconnection'})).toBeVisible()
 await dialog.getByRole('button',{name:'Close settings'}).click()
 dialog=await openAccount()
 const retry=dialog.getByRole('button',{name:'Finish disconnecting Synthetic interrupted client'})
 await expect(retry).toBeVisible();await harness.expectMinTapTarget(retry);await retry.click()
 await expect(retry).toHaveCount(0)
 expect(attempts).toBe(2)
})
