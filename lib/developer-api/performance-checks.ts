import { DEVELOPER_OPERATIONS } from './operations'

export interface ApiPerformanceSample {
 operation: string
 phase: 'first' | 'repeat'
 status: number
 clientMs: number
 serverMs: number | null
 authMs: number | null
 operationMs: number | null
 bytes: number
 scenario?: string
 expectedStatus?: number
 assertionsPassed?: boolean
}
export const PROVIDER_PERFORMANCE_OPERATIONS = new Set(['refresh_prices','refresh_price_checks','get_listings','start_comparison_job'])
export function readServerTiming(header:string|null,name:string):number|null {
 const match=header?.split(',').map(part=>part.trim()).find(part=>part.split(';')[0]===name)?.match(/(?:^|;)\s*dur=([\d.]+)(?:;|$)/)
 const value=match?Number(match[1]):NaN
 return Number.isFinite(value)&&value>=0?value:null
}
function median(values:number[]) {
 if(!values.length)return null
 const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2)
 return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2
}
export function summarizeApiPerformance(samples:readonly ApiPerformanceSample[]) {
 return DEVELOPER_OPERATIONS.map(operation=>{
  const measured=samples.filter(sample=>sample.operation===operation.name)
  const primary=measured.filter(sample=>(sample.scenario??'default')==='default'&&((sample.status>=200&&sample.status<300)||(operation.name==='start_comparison_job'&&sample.status===403&&sample.expectedStatus===403&&sample.assertionsPassed===true))&&sample.assertionsPassed!==false)
  const repeat=primary.filter(sample=>sample.phase==='repeat')
  const selected=repeat.length?repeat:primary
  const serverMedianMs=median(selected.flatMap(sample=>sample.serverMs===null?[]:[sample.serverMs]))
  return {operation:operation.name,method:operation.method,path:operation.path,write:operation.write,
   provider:PROVIDER_PERFORMANCE_OPERATIONS.has(operation.name),samples:measured.length,repeats:repeat.length,
   verified:primary.length>0&&measured.every(sample=>(sample.expectedStatus?sample.status===sample.expectedStatus:sample.status>=200&&sample.status<300)&&(Number(sample.expectedStatus??200)>=400||sample.serverMs!==null)&&sample.assertionsPassed!==false),
   firstMs:measured[0]?.clientMs??null,medianMs:median(selected.map(sample=>sample.clientMs)),serverMedianMs,
   authMedianMs:median(selected.flatMap(sample=>sample.authMs===null?[]:[sample.authMs])),
   operationMedianMs:median(selected.flatMap(sample=>sample.operationMs===null?[]:[sample.operationMs])),
   maxMs:measured.length?Math.max(...measured.map(sample=>sample.clientMs)):null,
   targetMs:PROVIDER_PERFORMANCE_OPERATIONS.has(operation.name)?null:30,
   targetMet:PROVIDER_PERFORMANCE_OPERATIONS.has(operation.name)||serverMedianMs===null?null:serverMedianMs<=30,
  }
 })
}
