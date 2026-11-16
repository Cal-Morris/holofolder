// The iOS app (native/) is com.holofolder.app under this Apple Developer team. Both are public: Apple reads
// them from https://holofolder.com/.well-known/apple-app-site-association.
const APPLE_TEAM_ID = '2CLM237SXL';
const IOS_APP_ID = `${APPLE_TEAM_ID}.com.holofolder.app`;

/**
 * Which holofolder.com links open the iOS app (Universal Links), and passkey sharing for the
 * holofolder.com relying party. Every `/app` page opens in the app, including the sign-in email
 * callback, so the email link signs the user in inside the app. Machine and developer surfaces
 * (REST, MCP, OAuth consent for MCP clients, developer docs, LLM exports) stay in the browser.
 */
export function appleAppSiteAssociation() {
  return {
    applinks: {
      details: [
        {
          appIDs: [IOS_APP_ID],
          components: [
            { '/': '/app/api/*', exclude: true },
            { '/': '/app/mcp*', exclude: true },
            { '/': '/app/oauth*', exclude: true },
            { '/': '/app/docs*', exclude: true },
            { '/': '/app/llms*', exclude: true },
            { '/': '/app/.well-known/*', exclude: true },
            { '/': '/app' },
            { '/': '/app/*' },
          ],
        },
      ],
    },
    webcredentials: { apps: [IOS_APP_ID] },
  };
}
