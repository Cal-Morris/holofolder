import { test, expect, E2E_USER, type Harness } from './fixtures'
import type { Page } from '@playwright/test'

const binder='e2e00000-0000-4000-8000-000000000001'
const scope={accountId:E2E_USER.id,ownerId:E2E_USER.id,membershipKey:'synthetic-membership'}
// Synthetic histories only. Two copies share a printing but retain different inventory IDs.
const bulk = {id:'9223372036854775807',recorded_at:'2026-11-09T12:00:00Z',format_version:1,actor_kind:'user',actor_user_id:E2E_USER.id,source:'mcp',client_id:'synthetic-client',action:'collection_change',affected_entities:{collectionIds:[binder],inventoryItemIds:['copy-a','copy-b']},changes:[
  {table:'inventory_items',id:'copy-a',before:{identity:{kind:'card',cardId:'base1-4'},grading:{provider:{kind:'known',id:'psa'},grade:'9',certificate:'SYNTHETIC-PRIVATE-CERT',label:{assetIds:['SYNTHETIC-PRIVATE-ART']}}},after:null},
  {table:'inventory_placements',id:'copy-b',before:{inventory_item_id:'copy-b',slot_id:'old-slot',collection_id:'deleted-collection'},after:null},
  ...Array.from({length:1025},(_,i)=>({table:'binder_slots',id:`slot-${i}`,before:{position:i,target:{kind:'card',cardId:'base1-4'}},after:{position:1025-i,target:{kind:'card',cardId:'base1-4'}}})),
]}
const legacy={id:'9223372036854775806',recorded_at:'2020-01-01T12:00:00Z',format_version:0,actor_kind:'unknown',source:'unknown',action:'legacy',pokemon_id:1,pokemon_name:'Synthetic Bulbasaur with an extremely long retained collection name from a deleted binder',before_state:{status:'collected'},after_state:{status:'uncollected'},affected_entities:{},changes:[]}
async function install(page:Page) {
  const queries:URLSearchParams[]=[]
  await page.route('**/app/api/collection-activity**',async route=>{
    const params=new URL(route.request().url()).searchParams
    if(params.get('scope')==='1')return route.fulfill({json:{scope}})
    queries.push(params)
    const offset=Number(params.get('cursor') ?? 0)
    const filtered=params.has('cardId') || params.has('actorId')
    const history=Array.from({length:1105},(_,i)=>i===0 ? bulk : i===1 ? legacy : {...legacy,id:String(BigInt('9223372036854775807')-BigInt(i)),pokemon_name:`Synthetic event ${i}`})
    const data=filtered ? [] : history.slice(offset,offset+50)
    return route.fulfill({json:{scope,data,nextCursor:filtered || offset+50>=1105 ? null : String(offset+50),syncedAt:'2026-11-09T12:01:00Z'}})
  })
  return queries
}
async function open(harness:Harness) {
  await harness.page.getByTestId('binder-switcher-trigger').click()
  await harness.page.getByRole('dialog',{name:'Binders',exact:true}).getByRole('button',{name:'Activity',exact:true}).click()
  const dialog=harness.page.getByRole('dialog',{name:'Collection Activity',exact:true})
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('list',{name:'Committed activity'})).toBeVisible()
  await expect(dialog.getByRole('article').first()).toBeVisible()
  return dialog
}
test.describe('collection Activity',()=>{
  test.use({signedIn:true})
  test('safe mobile history, bulk progressive details, exact server filters and more than 1000 events',async({harness},testInfo)=>{
    const queries=await install(harness.page)
    await harness.page.goto('/app/e2e-harness?signedIn=1&binders=1')
    const dialog=await open(harness)
    const close=dialog.getByRole('button',{name:'Close Activity'})
    await harness.expectMinTapTarget(close);await harness.expectWithinSafeViewport(close);await harness.expectHittable(close)
    const box=(await dialog.boundingBox())!,dock=(await harness.dock().boundingBox())!
    expect(box.y+box.height).toBeLessThanOrEqual(dock.y)
    console.log(JSON.stringify({activityLayout:{project:testInfo.project.name,top:box.y,bottom:box.y+box.height,dockTop:dock.y,closeWidth:(await close.boundingBox())!.width}}))
    await expect(dialog.getByText(/Unknown ·/).first()).toBeVisible()
    await dialog.getByRole('button',{name:'View 1027 changes',exact:true}).click()
    await expect(dialog.getByRole('heading',{name:/Removed a card/})).toBeVisible()
    await expect(dialog.getByRole('heading',{name:/Unassigned an item/})).toBeVisible()
    await expect(dialog).not.toContainText('Technical details')
    await expect(dialog).not.toContainText('synthetic-client')
    await expect(dialog).not.toContainText(E2E_USER.id)
    await expect(dialog.getByRole('button',{name:'Undo',exact:true})).toHaveCount(0)
    await expect(dialog).not.toContainText('SYNTHETIC-PRIVATE-CERT');await expect(dialog).not.toContainText('SYNTHETIC-PRIVATE-ART')
    await expect(dialog.getByRole('heading',{name:/Updated a slot/})).toHaveCount(8)
    await dialog.getByRole('button',{name:/Show more changes/}).click()
    await expect(dialog.getByRole('heading',{name:/Updated a slot/})).toHaveCount(33)
    await harness.expectNoHorizontalOverflow()
    await harness.page.screenshot({path:`/tmp/holofolder395-activity-${testInfo.project.name}.png`})
    await harness.page.evaluate(()=>document.documentElement.classList.remove('dark'))
    await harness.expectNoHorizontalOverflow()
    await harness.page.evaluate(()=>document.documentElement.classList.add('dark'))
    await dialog.getByRole('button',{name:'Filters',exact:true}).click()
    await dialog.getByRole('combobox',{name:'Collection',exact:true}).selectOption('')
    await expect(dialog).not.toContainText('Advanced filters')
    await dialog.getByRole('combobox',{name:'Person',exact:true}).selectOption(E2E_USER.id)
    await dialog.getByLabel('From (UTC)').fill('2026-11-01')
    await dialog.getByLabel('Through (UTC)').fill('2026-11-09')
    await dialog.getByRole('combobox',{name:'Action',exact:true}).selectOption('collection_item')
    await dialog.getByRole('button',{name:'Apply filters',exact:true}).focus()
    await harness.page.keyboard.press('Enter')
    await expect(dialog.getByText('No activity matches these filters.')).toBeVisible()
    expect(queries.at(-1)?.get('actorId')).toBe(E2E_USER.id)
    expect(queries.at(-1)?.get('since')).toBe('2026-11-01T00:00:00.000Z');expect(queries.at(-1)?.has('collectionId')).toBe(false)
    await close.click()
    const again=await open(harness)
    for(let i=0;i<22;i++) {
      const older=again.getByRole('button',{name:'Older page',exact:true})
      await expect(older).toBeVisible();await older.click()
      await expect(again.getByText(`Synthetic event ${(i+1)*50}`,{exact:false}).first()).toBeVisible()
    }
    expect(queries.at(-1)?.get('cursor')).toBe('1100')
    await expect(again.getByRole('button',{name:'Older page',exact:true})).toHaveCount(0)
    await close.click();await harness.expectScrollUnlocked();await expect(harness.page.getByTestId('binder-switcher-trigger')).toBeFocused()
  })
  test('Activity replaces item detail and closes by X, Escape, back, backdrop, swipe and dock',async({harness})=>{
    const queries=await install(harness.page)
    await harness.page.goto('/app/e2e-harness?signedIn=1&binders=1')
    const detail=await harness.openCardDetail()
    await detail.getByRole('button',{name:'Activity',exact:true}).click()
    const dialog=harness.page.getByRole('dialog',{name:'Collection Activity'})
    await expect(dialog).toBeVisible();await expect(harness.dialogs()).toHaveCount(1)
    await expect.poll(()=>queries.at(-1)?.get('pokemonId')).toBe('1')
    await dialog.getByRole('button',{name:'Close Activity'}).click();await expect(dialog).toBeHidden()
    for(const method of ['escape','back','backdrop','swipe','dock'] as const) {
      await open(harness)
      if(method==='escape')await harness.page.keyboard.press('Escape')
      if(method==='back')await harness.page.goBack()
      if(method==='backdrop')await harness.tapBackdrop(dialog)
      if(method==='swipe')await harness.swipeDown(dialog)
      if(method==='dock')await harness.dock().getByRole('button',{name:'List',exact:true}).click()
      await expect(dialog).toBeHidden();await harness.expectScrollUnlocked()
    }
  })
  test('offline cached and uncached pages are honest and public shares have no Activity',async({harness})=>{
    await install(harness.page)
    await harness.page.goto('/app/e2e-harness?signedIn=1&binders=1')
    const dialog=await open(harness)
    await expect(dialog.getByRole('article').first()).toBeVisible()
    await harness.page.context().setOffline(true)
    await harness.page.evaluate(()=>window.dispatchEvent(new Event('offline')))
    await expect(dialog.getByText(/Saved activity/)).toBeVisible()
    await dialog.getByRole('button',{name:'Older page',exact:true}).click()
    await expect(dialog.getByText('Connect to load this activity.')).toBeVisible()
    await dialog.getByRole('button',{name:'Close Activity'}).click()
    await harness.page.context().setOffline(false)
    await harness.page.goto('/app/e2e-harness?signedIn=1&binders=1&readOnly=1')
    await harness.openCardDetail()
    await expect(harness.page.getByRole('button',{name:'Activity',exact:true})).toHaveCount(0)
    expect(await harness.page.evaluate(()=>localStorage.getItem('holofolder_activity_cache_v1'))).toBeNull()
  })
  test('membership change and logout discard private pages and an old async response',async({harness})=>{
    const {page}=harness
    let currentScope=scope
    let hold=false
    let release:()=>void=()=>{}
    let started:()=>void=()=>{}
    let delivered:()=>void=()=>{}
    const pending=new Promise<void>(resolve=>{started=resolve})
    const finished=new Promise<void>(resolve=>{delivered=resolve})
    const gate=new Promise<void>(resolve=>{release=resolve})
    await page.route('**/app/api/collection-activity**',async route=>{
      const params=new URL(route.request().url()).searchParams
      if(params.get('scope')==='1')return route.fulfill({json:{scope:currentScope}})
      const responseScope=currentScope
      if(hold) {
        started();await gate
        try {await route.fulfill({json:{scope:responseScope,data:[{...legacy,pokemon_name:'STALE MEMBERSHIP EVENT'}],nextCursor:null,syncedAt:'2026-11-09T12:00:00Z'}})} catch { /* The aborted request may already be gone. */ }
        delivered();return
      }
      return route.fulfill({json:{scope:responseScope,data:[{...legacy,pokemon_name:currentScope.membershipKey==='synthetic-new-membership'?'CURRENT MEMBERSHIP EVENT':'Synthetic original event'}],nextCursor:null,syncedAt:'2026-11-09T12:01:00Z'}})
    })
    await page.goto('/app/e2e-harness?signedIn=1&binders=1')
    const dialog=await open(harness)
    await expect(dialog.getByText(/Synthetic original event/)).toBeVisible()
    hold=true
    await dialog.getByRole('button',{name:'Refresh',exact:true}).click()
    await pending
    hold=false
    currentScope={...scope,membershipKey:'synthetic-new-membership'}
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
    await expect(dialog.getByText(/CURRENT MEMBERSHIP EVENT/)).toBeVisible()
    release();await finished
    await expect(dialog).not.toContainText('STALE MEMBERSHIP EVENT')
    expect(await page.evaluate(()=>localStorage.getItem('holofolder_activity_cache_v1'))).not.toContain('STALE MEMBERSHIP EVENT')
    await dialog.getByRole('button',{name:'Close Activity'}).click()
    await page.route('**/app/auth/logout**',route=>route.fulfill({contentType:'text/html',body:'<p>Signed out synthetic fixture</p>'}))
    await page.getByTestId('app-header').getByRole('button',{name:'More',exact:true}).click()
    await page.getByRole('menuitem',{name:'Sign out',exact:true}).click()
    await expect(page.getByText('Signed out synthetic fixture')).toBeVisible()
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem('holofolder_activity_cache_v1'))).toBeNull()
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem('holofolder_activity_scope_v1'))).toBeNull()
  })

})
