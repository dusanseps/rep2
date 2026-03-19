/**
 * Azure AD / MSAL configuration
 *
 * Pred spustením vyplňte:
 *  1. clientId  – Client ID z registrácie aplikácie v Azure AD (portal.azure.com)
 *  2. tenantId  – Tenant ID vašej organizácie (alebo "common")
 *  3. Pridajte redirectUri do "Redirect URIs" v Azure AD app registration
 *
 * Požadované API permissions v Azure AD:
 *   • Microsoft Graph → User.Read (delegated)
 *   • SharePoint      → AllSites.Read (delegated)  — pre čítanie udalostí, noviniek, tickera
 *   • SharePoint      → AllSites.Write (delegated) — pre správu tickera (pridávanie/mazanie správ)
 */

export const MSAL_CONFIG = {
  auth: {
    clientId: 'YOUR_CLIENT_ID',        // ← vyplňte Client ID z Azure AD
    authority: 'https://login.microsoftonline.com/YOUR_TENANT_ID',  // ← vyplňte Tenant ID
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

/** Scopy pre SharePoint REST API */
export const SP_SCOPES = [
  'https://sepssk.sharepoint.com/AllSites.Read',
  'https://sepssk.sharepoint.com/AllSites.Write',
];

/** Scopy pre Microsoft Graph (user info) */
export const GRAPH_SCOPES = ['User.Read'];
