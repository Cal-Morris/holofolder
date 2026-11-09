import {test} from "node:test"
import {execFileSync} from "node:child_process"
import assert from "node:assert/strict"
import {legacyAnalyticsEntries} from "../lib/collection-analytics"

test("private audit REST/MCP registry reads paginate beyond 1000 without private fields",()=>{
 execFileSync(process.execPath,[new URL("./fixtures/collection-audit-reads.ts",import.meta.url).pathname],{stdio:"pipe"})
})
test("analytics preserves bulk legacy changes and excludes structural acquisitions",()=>{
 const original={id:"1",pokemon_id:1,pokemon_name:"Synthetic",before_state:null,after_state:{status:"collected"}}
 assert.deepEqual(legacyAnalyticsEntries(original),[original])
 const bulk={id:"2",recorded_at:"2020-01-01T00:00:00Z",changes:[{table:"binders",before:null,after:{id:"synthetic"}},
 {table:"pokemon_collection",before:null,after:{pokemon_id:2,pokemon_name:"Synthetic two",status:"collected",card_id:null}}]}
 const entries=legacyAnalyticsEntries(bulk)
 assert.equal(entries.length,1);assert.equal(entries[0].pokemon_id,2)
 assert.deepEqual(legacyAnalyticsEntries({...bulk,changes:[bulk.changes[0]]}),[])
})
