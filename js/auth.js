// Anmeldung mit dem eigenen Microsoft-Konto (MSAL.js, wird in index.html geladen: globales "msal").
// Gleiche App-Registrierung wie die Android-App, nur private Microsoft-Konten.

import { AuthError } from './onedrive.js';

const CLIENT_ID = 'c4a18d92-13ff-4888-8294-97d70d1fb86b';
const SCOPES = ['Files.ReadWrite'];

let app = null;

/** Adresse, an die Microsoft nach der Anmeldung zurückschickt (muss im Azure-Portal eingetragen sein). */
export function redirectUri() {
  return new URL('.', location.href).href;
}

/** Beim Start aufrufen: verarbeitet auch die Rückkehr von der Microsoft-Anmeldung. */
export async function initAuth() {
  app = new msal.PublicClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: 'https://login.microsoftonline.com/consumers',
      redirectUri: redirectUri(),
      postLogoutRedirectUri: redirectUri(),
    },
    cache: { cacheLocation: 'localStorage' },
  });
  await app.initialize();
  const result = await app.handleRedirectPromise();
  if (result?.account) app.setActiveAccount(result.account);
  if (!app.getActiveAccount()) {
    const accounts = app.getAllAccounts();
    if (accounts.length) app.setActiveAccount(accounts[0]);
  }
  return account();
}

/** Angemeldetes Konto ({ name, username }) oder null. */
export function account() {
  const a = app?.getActiveAccount();
  return a ? { name: a.name || a.username, username: a.username } : null;
}

export function signIn() {
  return app.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
}

export function signOut() {
  return app.logoutRedirect({ account: app.getActiveAccount() });
}

/** Zugangsschlüssel für OneDrive. Ist die Anmeldung abgelaufen: AuthError. */
export async function getToken() {
  const a = app?.getActiveAccount();
  if (!a) throw new AuthError('Nicht angemeldet.', 401);
  try {
    return (await app.acquireTokenSilent({ scopes: SCOPES, account: a })).accessToken;
  } catch (e) {
    if (e instanceof msal.InteractionRequiredAuthError) throw new AuthError('Bitte neu anmelden.', 401);
    throw e;
  }
}

/** Erneut anmelden (wenn getToken AuthError gemeldet hat). */
export function signInAgain() {
  return app.acquireTokenRedirect({ scopes: SCOPES, account: app.getActiveAccount() });
}
