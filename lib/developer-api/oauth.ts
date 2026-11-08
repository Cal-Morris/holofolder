import {DeveloperAccessError} from './permissions'
export const MCP_RESOURCE='https://app.holofolder.com/app/mcp'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function validateMcpClaims(value:Record<string,unknown>,issuer:string,now=Math.floor(Date.now()/1000)) {
 if(value.iss!==issuer || value.aud!==MCP_RESOURCE || value.role!=='holo_mcp' || typeof value.exp!=='number' || !Number.isFinite(value.exp) || value.exp<=now || ['sub','client_id','session_id','developer_grant_id'].some(k=>typeof value[k]!=='string'||!UUID.test(value[k] as string))) {
  throw new DeveloperAccessError('invalid_oauth_token','Connect this MCP client through Holo Folder OAuth.',401)
 }
 return {actorId:value.sub as string,clientId:value.client_id as string,sessionId:value.session_id as string,grantId:value.developer_grant_id as string}
}
export function validateMcpOrigin(origin:string|null|undefined,redirectOrigin:string) {
 if(origin && (origin==='null'||(origin!=='https://holofolder.com'&&origin!==redirectOrigin)))throw new DeveloperAccessError('invalid_origin','This origin was not authorized for this MCP client.',403)
}

export function needsOAuthRevocation(grant:{revoked_at:unknown;auth_revoked_at:unknown}) {return Boolean(grant.revoked_at&&!grant.auth_revoked_at)}
