function record(value:unknown):Record<string,unknown> {return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}}
export function readExternalIdentifiers(value:unknown):Record<string,string[]> {
 const external=record(value),tcgdex=record(external.tcgdex),output:Record<string,string[]>={}
 function add(provider:string,id:unknown) {
  if((typeof id!=='string'&&typeof id!=='number')||!String(id)||String(id).length>200||String(id).includes('://'))return
  const ids=output[provider]??=[]
  if(!ids.includes(String(id)))ids.push(String(id))
 }
 const variants=Array.isArray(tcgdex.variantThirdParty)?tcgdex.variantThirdParty:[]
 for(const thirdParty of [tcgdex.thirdParty,...variants])for(const provider of ['tcgplayer','cardmarket','scrydex'])add(provider,record(thirdParty)[provider])
 for(const provider of ['tcgplayer','cardmarket','pokemontcg','scrydex']) {const entry=record(external[provider]);add(provider,entry.id??entry.productId)}
 add('pokemontcg',record(external.pokemon_tcg).cardId)
 add('tcgplayer',record(external.catalog).productId)
 return output
}
