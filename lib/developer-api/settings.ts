import {createHash} from 'node:crypto'
function stable(value:unknown):unknown {
 if(Array.isArray(value))return value.map(stable)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,stable(entry)]))
 return value
}
export function settingsFingerprint(row:unknown,layout:unknown) {return createHash('sha256').update(JSON.stringify(stable({row,layout}))).digest('hex')}
