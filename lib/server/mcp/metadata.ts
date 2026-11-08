import {MCP_RESOURCE} from '@/lib/developer-api/oauth'
export const MCP_METADATA_URL='https://app.holofolder.com/app/.well-known/oauth-protected-resource'
export function protectedResourceMetadata(issuer:string) {
 return {resource:MCP_RESOURCE,resource_name:'Holo Folder',authorization_servers:[issuer],bearer_methods_supported:['header'],resource_documentation:'https://holofolder.com/docs/mcp'}
}
