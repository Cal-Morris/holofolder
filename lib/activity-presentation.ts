import type { ActivityChange, ActivityEvent, ActivityState } from '@/lib/collection-activity'

const languages: Record<string,string> = {en:'English',ja:'Japanese',fr:'French',de:'German',es:'Spanish',it:'Italian',ko:'Korean','pt-br':'Portuguese'}
const statuses: Record<string,string> = {collected:'Collected',finalized:'Finalized',considering:'Considering',wishlisted:'Wanted',uncollected:'Not collected'}
const record = (v:unknown): v is ActivityState => !!v && typeof v==='object' && !Array.isArray(v)
const text = (v:unknown) => typeof v==='string' && v.trim() ? v : null
const human = (v:unknown):string => v==null ? 'Not set' : typeof v==='boolean' ? v ? 'Yes' : 'No' : typeof v==='string' ? languages[v] ?? statuses[v] ?? (v.replaceAll('_',' ').replace(/^./,s=>s.toUpperCase())) : typeof v==='number' ? String(v) : 'Changed'
const number = (s:ActivityState|null) => typeof s?.card_id==='string' ? s.card_id.match(/-([\d]+[a-z]?)$/i)?.[1] : null
const printing = (s:ActivityState|null) => [text(s?.card_set),number(s) ? `#${number(s)}` : null].filter(Boolean).join(' · ') || 'Another printing'
const deltas = (e:ActivityEvent):ActivityChange[] => e.changes.length ? e.changes : e.before_state || e.after_state ? [{table:'pokemon_collection',id:'',before:e.before_state ?? null,after:e.after_state ?? null}] : []
function name(s:ActivityState|null,e:ActivityEvent) {
  const identity = record(s?.identity) ? s.identity : record(s?.target) ? s.target : null
  return text(s?.card_name) ?? text(s?.pokemon_name) ?? text(s?.name) ?? text(e.pokemon_name) ?? (text(s?.card_id) || text(identity?.cardId) ? 'a card' : 'an item')
}
function verb(c:ActivityChange) {
  const {before:b,after:a,table:t}=c
  if(t==='binders') return !a ? 'Deleted' : !b ? 'Created' : b.name!==a.name ? 'Renamed' : 'Updated'
  if(t==='inventory_placements') return !a ? 'Unassigned' : !b ? 'Assigned' : 'Moved'
  if(t==='binder_slots') return !a ? 'Removed slot' : !b ? 'Added slot' : 'Updated slot'
  if(t==='user_settings'||t==='binder_appearances'||t==='binder_shares') return 'Updated'
  if(!a) return 'Removed'
  if(!b) return a.status==='wishlisted' ? 'Added to want list:' : 'Added'
  if(b.status!==a.status && ['collected','finalized'].includes(String(a.status))) return 'Collected'
  if(JSON.stringify(b.wanted_cards)!==JSON.stringify(a.wanted_cards)) return 'Updated want list for'
  if(a.status==='wishlisted' && b.status!==a.status) return 'Moved to want list:'
  return 'Updated'
}
export function readableActivityChanges(event:ActivityEvent) {
  const labels: Record<string,string> = {status:'Status',card_name:'Card',card_set:'Set',card_finish:'Finish',card_language:'Language',name:'Name',condition:'Condition',grade:'Grade',grading_company:'Grading company',quantity:'Quantity',favorite:'Favourite',rows:'Rows',cols:'Columns',show_prices:'Show prices',is_enabled:'Sharing',position:'Position'}
  return deltas(event).filter(c=>!['inventory_owner_state','storage_collection_state','binder_legacy_rows'].includes(c.table)).map(c=>{
    const s=c.after??c.before
    const title=c.table==='binders' && c.before && c.after && c.before.name!==c.after.name ? `Renamed ${name(c.before,event)} to ${name(c.after,event)}` : `${verb(c)} ${name(s,event)}`
    const subtitle=[text(s?.card_set),number(s) ? `#${number(s)}` : null,s?.card_finish ? human(s.card_finish) : null,s?.card_language ? human(s.card_language) : null].filter(Boolean).join(' · ')
    const fields=c.before && c.after ? Object.entries(labels).filter(([key])=>JSON.stringify(c.before?.[key])!==JSON.stringify(c.after?.[key])).map(([key,label])=>({label,before:human(c.before?.[key]),after:human(c.after?.[key])})) : []
    if(c.before && c.after && c.before.card_id!==c.after.card_id)fields.unshift({label:'Printing',before:printing(c.before),after:printing(c.after)})
    if(c.before && c.after && JSON.stringify(c.before.wanted_cards)!==JSON.stringify(c.after.wanted_cards)) {
      const wants=(s:ActivityState)=>Array.isArray(s.wanted_cards) ? s.wanted_cards.map(v=>record(v) ? text(v.card_name) ?? 'Card' : 'Card').join(', ') || 'No wanted cards' : 'No wanted cards'
      fields.push({label:'Want list',before:wants(c.before),after:wants(c.after)})
    }
    return {title,subtitle,fields}
  })
}
export function activitySummary(event:ActivityEvent,binders:readonly {id:string;name:string}[]=[]) {
  const changes=deltas(event)
  const visible=readableActivityChanges(event)
  const collections=binders.filter(b=>event.affected_entities.collectionIds?.includes(b.id))
  const primary=changes.filter(c=>['pokemon_collection','inventory_items','binders'].includes(c.table))
  let title=visible[0]?.title ?? 'Updated collection'
  if(primary.length>1) {
    const verbs=new Set(primary.map(verb))
    title=`${verbs.size===1 ? verb(primary[0]) : 'Changed'} ${primary.length} ${primary.every(c=>c.table==='binders') ? 'collections' : 'cards'}`
  } else if(changes.length>1 && !primary.length) title=`Updated ${visible.length} slots`
  if(event.action==='recovery.apply') title='Undid a change'
  else if(collections.length===1 && !changes.some(c=>c.table==='binders')) title+=` ${verb(primary[0]??changes[0]??{table:'',id:'',before:null,after:null})==='Removed' ? 'from' : 'in'} ${collections[0].name}`
  return {title,subtitle:visible.length===1 ? visible[0].subtitle : `${visible.length} changes`,count:visible.length}
}
export function activityDay(value:string,now=new Date()) {
  const date=new Date(value)
  if(Number.isNaN(date.getTime())) return 'Earlier'
  if(date.toDateString()===now.toDateString()) return 'Today'
  const yesterday=new Date(now);yesterday.setDate(now.getDate()-1)
  return date.toDateString()===yesterday.toDateString() ? 'Yesterday' : date.toLocaleDateString(undefined,{day:'numeric',month:'long',...(date.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})})
}

export function activityReceipt(event:ActivityEvent) {
  const changes=readableActivityChanges(event)
  return {
    changes,
    hasDetails:changes.length>1 || changes.some(change=>change.fields.length>0),
    canUndo:event.format_version===1 && event.action!=='recovery.apply' && event.changes.length>0 && event.changes.every(change=>change.table==='pokemon_collection'),
  }
}
