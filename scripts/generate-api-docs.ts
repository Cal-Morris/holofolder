import {writeFile,mkdir} from 'node:fs/promises'
import {z} from 'zod'
import {DEVELOPER_OPERATIONS} from '@/lib/developer-api/operations'
async function main() {
 const paths:Record<string,Record<string,unknown>>={}
 for(const op of DEVELOPER_OPERATIONS) {
  const schema=z.toJSONSchema(op.schema) as {properties?:Record<string,unknown>;required?:string[];[key:string]:unknown}
  const pathKeys=[...op.path.matchAll(/\{([^}]+)\}/g)].map(match=>match[1])
  const parameters:Array<{name:string;in:string;required:boolean;schema:unknown}>=pathKeys.map(name=>({name,in:'path',required:true,schema:schema.properties?.[name]??{type:'string'}}))
  const properties=Object.fromEntries(Object.entries(schema.properties??{}).filter(([name])=>!pathKeys.includes(name)&&name!=='idempotencyKey'))
  const required=(schema.required??[]).filter(name=>!pathKeys.includes(name)&&name!=='idempotencyKey')
  if(op.method==='GET')for(const [name,property]of Object.entries(properties))parameters.push({name,in:'query',required:required.includes(name),schema:property})
  if(schema.properties?.idempotencyKey)parameters.push({name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:100}})
  const description=`${op.description}\n\nRequired permissions: ${op.permissions.map(p => '`' + p + '`').join(', ')}. MCP tool: \`${op.name}\`.`
  const group = /^\/(cards|sets|series|languages|pokemon|illustrators)(\/|$)/.test(op.path) ? 'Catalog' : /^\/(prices|price-checks|comparison-jobs|deals|listings|analytics)(\/|$)/.test(op.path) ? 'Prices and insights' : /^\/(settings|identity|partners)(\/|$)/.test(op.path) ? 'Account' : 'Collection'
  const label = op.name.replaceAll('_', ' ')
  const summary = op.name === 'list_cards' ? 'Search cards' : label.charAt(0).toUpperCase() + label.slice(1)
  paths[op.path]??={};paths[op.path][op.method.toLowerCase()]={operationId:op.name,summary,description,tags:[group],security:[{apiKey:[]}],parameters,
   ...(op.method==='GET'?{}:{requestBody:{required:true,content:{'application/json':{schema:{...schema,properties,required}}}}}),responses:Object.fromEntries([200,400,401,402,403,404,409,413,422,429,503].map(status=>[String(status),{description:status===200?'Success':'See the API conventions page.'}]))}
 }
 const spec={openapi:'3.1.0',info:{title:'Holo Folder API',version:'1.0.0',description:'Premium/lifetime data API. MCP uses OAuth separately. Card image fields are R2-only.'},servers:[{url:'https://app.holofolder.com/app/api/v1',description:'Holo Folder production API'}],components:{securitySchemes:{apiKey:{type:'http',scheme:'bearer',bearerFormat:'Holo Folder personal API key'}}},paths}
 await mkdir('public',{recursive:true});await writeFile('public/openapi.json',JSON.stringify(spec,null,2)+'\n')
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Documentation generation failed');process.exitCode=1})
