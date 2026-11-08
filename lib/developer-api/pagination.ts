import {createHash} from 'node:crypto'
import {DeveloperAccessError} from './permissions'
function queryHash(params:URLSearchParams) {
 const entries=[...params.entries()].filter(([k])=>k!=='cursor').sort(([a,av],[b,bv])=>a.localeCompare(b)||av.localeCompare(bv))
 return createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0,24)
}
export function encodeCursor(after:string,params:URLSearchParams) {return Buffer.from(JSON.stringify({after,query:queryHash(params)})).toString('base64url')}
export function decodePage(params:URLSearchParams):{limit:number;after:string|null} {
 const invalid=()=>new DeveloperAccessError('invalid_pagination','Use a limit from 1 to 100 and a cursor from the same query.',400)
 const raw=params.get('limit')??'50',limit=Number(raw)
 if(!/^\d{1,3}$/.test(raw)||!Number.isInteger(limit)||limit<1||limit>100) throw invalid()
 const cursor=params.get('cursor')
 if(!cursor) return {limit,after:null}
 if(cursor.length>1024||!/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid()
 try {const parsed=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(typeof parsed.after!=='string'||parsed.after.length>200||!parsed.after||parsed.query!==queryHash(params)) throw invalid();return {limit,after:parsed.after}}
 catch {throw invalid()}
}
