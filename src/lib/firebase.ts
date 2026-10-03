import { initializeApp, type FirebaseApp } from 'firebase/app'
import { browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, EmailAuthProvider, getAuth, getRedirectResult, GoogleAuthProvider, linkWithCredential, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, updateProfile, type Auth, type AuthCredential, type User } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getDatabase, type Database } from 'firebase/database'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

const env = import.meta.env
const configuredAuthDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim()
const firstPartyAuthDomain = env.VITE_FIREBASE_FIRST_PARTY_AUTH_DOMAIN?.trim()

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  // Use the Firebase project's auth domain by default. A first-party app
  // domain is opt-in because it must also be registered in the Google OAuth
  // web client; selecting it only from the browser hostname causes a
  // redirect_uri_mismatch in production.
  authDomain: firstPartyAuthDomain || configuredAuthDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
}

const requiredConfigKeys: Array<keyof typeof firebaseConfig> = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']
export const hasFirebaseConfig = requiredConfigKeys.every((key) => Boolean(firebaseConfig[key]))
export const hasRealtimeDatabaseConfig = Boolean(firebaseConfig.databaseURL)

let app: FirebaseApp | undefined
let auth: Auth | undefined
let firestore: Firestore | undefined
let database: Database | undefined
let storage: FirebaseStorage | undefined

if (hasFirebaseConfig) {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  firestore = getFirestore(app)
  storage = getStorage(app)
  if (firebaseConfig.databaseURL) database = getDatabase(app, firebaseConfig.databaseURL)
}

export { app, auth, firestore, database, storage }

async function keepSession(authInstance: Auth) {
  try {
    await setPersistence(authInstance, browserLocalPersistence)
  } catch {
    // Some mobile browsers restrict localStorage (private mode or hardened
    // cookie settings). Session persistence still survives the OAuth redirect.
    await setPersistence(authInstance, browserSessionPersistence)
  }
}

const pendingGoogleLinkStorageKey = 'luma.pending-google-link'

type PendingGoogleLink = {
  email: string
  credential: AuthCredential
}

type SerializedGoogleCredential = {
  email: string
  idToken?: string
  accessToken?: string
}

function normalizedEmail(email: string) {
  return email.trim().toLowerCase()
}

function sessionStorageOrNull() {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function serializeGoogleCredential(email: string, credential: AuthCredential): SerializedGoogleCredential | null {
  const value = credential.toJSON() as { idToken?: unknown; accessToken?: unknown }
  const idToken = typeof value.idToken === 'string' ? value.idToken : undefined
  const accessToken = typeof value.accessToken === 'string' ? value.accessToken : undefined
  if (!idToken && !accessToken) return null
  return { email, idToken, accessToken }
}

function restorePendingGoogleLink(): PendingGoogleLink | null {
  const storage = sessionStorageOrNull()
  if (!storage) return null
  try {
    const raw = storage.getItem(pendingGoogleLinkStorageKey)
    if (!raw) return null
    const value = JSON.parse(raw) as SerializedGoogleCredential
    if (!value.email || (!value.idToken && !value.accessToken)) return null
    return {
      email: value.email,
      credential: GoogleAuthProvider.credential(value.idToken, value.accessToken),
    }
  } catch {
    return null
  }
}

let pendingGoogleLink: PendingGoogleLink | null = restorePendingGoogleLink()

function rememberPendingGoogleLink(email: string, credential: AuthCredential) {
  const normalized = normalizedEmail(email)
  pendingGoogleLink = { email: normalized, credential }
  const serialized = serializeGoogleCredential(normalized, credential)
  const storage = sessionStorageOrNull()
  if (!serialized || !storage) return
  try {
    storage.setItem(pendingGoogleLinkStorageKey, JSON.stringify(serialized))
  } catch {
    // The in-memory credential remains usable for popup flows when storage is restricted.
  }
}

function clearPendingGoogleLink() {
  pendingGoogleLink = null
  const storage = sessionStorageOrNull()
  try { storage?.removeItem(pendingGoogleLinkStorageKey) } catch { /* Storage can be unavailable in private browsing. */ }
}

function conflictEmail(error: unknown) {
  const value = error as { email?: unknown; customData?: { email?: unknown } }
  const email = typeof value.customData?.email === 'string' ? value.customData.email : value.email
  return typeof email === 'string' ? email : ''
}

function isGoogleCredentialConflict(error: unknown) {
  return (error as { code?: unknown }).code === 'auth/account-exists-with-different-credential'
}

function captureGoogleCredentialConflict(error: unknown): never {
  const credential = GoogleAuthProvider.credentialFromError(error as Parameters<typeof GoogleAuthProvider.credentialFromError>[0])
  const email = conflictEmail(error)
  if (credential && email) {
    rememberPendingGoogleLink(email, credential)
    throw new GoogleAccountLinkRequiredError(email)
  }
  throw error
}

export class GoogleAccountLinkRequiredError extends Error {
  readonly code = 'auth/account-link-required'
  readonly email: string

  constructor(email: string) {
    super('An account already exists with this email. Sign in with your password once to connect Google to this account.')
    this.name = 'GoogleAccountLinkRequiredError'
    this.email = email
  }
}

export class PendingGoogleEmailMismatchError extends Error {
  readonly code = 'auth/pending-google-email-mismatch'

  constructor() {
    super('Use the same email address that you selected in Google to finish connecting your accounts.')
    this.name = 'PendingGoogleEmailMismatchError'
  }
}

export function getPendingGoogleLinkEmail() {
  return pendingGoogleLink?.email ?? null
}

export function shouldLinkPendingGoogleCredential(pendingEmail: string, signedInEmail: string) {
  return normalizedEmail(pendingEmail) === normalizedEmail(signedInEmail)
}

export function hasPasswordProvider() {
  return Boolean(auth?.currentUser?.providerData.some((provider) => provider.providerId === 'password'))
}

export function observeAuth(callback: (user: User | null) => void) {
  if (!auth) return () => undefined
  return onAuthStateChanged(auth, callback)
}

export async function registerWithEmail(email: string, password: string, displayName: string) {
  if (!auth) throw new Error('Firebase is not configured.')
  await keepSession(auth)
  const result = await createUserWithEmailAndPassword(auth, email, password)
  if (displayName.trim()) await updateProfile(result.user, { displayName: displayName.trim() })
  return result.user
}

export async function loginWithEmail(email: string, password: string) {
  if (!auth) throw new Error('Firebase is not configured.')
  await keepSession(auth)
  const result = await signInWithEmailAndPassword(auth, email, password)
  if (pendingGoogleLink) {
    if (!shouldLinkPendingGoogleCredential(pendingGoogleLink.email, email)) {
      await signOut(auth)
      throw new PendingGoogleEmailMismatchError()
    }
    try {
      await linkWithCredential(result.user, pendingGoogleLink.credential)
      clearPendingGoogleLink()
    } catch (error) {
      if ((error as { code?: string }).code === 'auth/provider-already-linked') {
        clearPendingGoogleLink()
      } else {
        await signOut(auth).catch(() => undefined)
        throw error
      }
    }
  }
  return result.user
}

export async function loginWithGoogle() {
  if (!auth) throw new Error('Firebase is not configured.')
  await keepSession(auth)
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  const isMobile = typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 680px)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
  if (isMobile) {
    await signInWithRedirect(auth, provider)
    return null
  }
  try {
    const result = await signInWithPopup(auth, provider)
    clearPendingGoogleLink()
    return result.user
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider)
      return null
    }
    if (isGoogleCredentialConflict(error)) captureGoogleCredentialConflict(error)
    throw error
  }
}

export async function completeGoogleRedirect() {
  if (!auth) return null
  try {
    const result = await getRedirectResult(auth)
    if (result) clearPendingGoogleLink()
    return result
  } catch (error) {
    if (isGoogleCredentialConflict(error)) captureGoogleCredentialConflict(error)
    throw error
  }
}

export async function linkEmailPasswordToCurrentUser(password: string) {
  if (!auth?.currentUser) throw new Error('You must be signed in before adding a password.')
  if (!auth.currentUser.email) throw new Error('This account does not have an email address for password sign-in.')
  const credential = EmailAuthProvider.credential(auth.currentUser.email, password)
  await linkWithCredential(auth.currentUser, credential)
  return auth.currentUser
}

export function authErrorMessage(error: unknown) {
  const code = (error as { code?: string }).code ?? ''
  const messages: Record<string, string> = {
    'auth/account-link-required': 'An account already exists with this email. Sign in with your password once to connect Google to this account.',
    'auth/pending-google-email-mismatch': 'Use the same email address that you selected in Google to finish connecting your accounts.',
    'auth/unauthorized-domain': 'This deployment domain is not authorized in Firebase. Add the exact Vercel or Render hostname under Firebase Authentication → Settings → Authorized domains.',
    'auth/operation-not-allowed': 'This sign-in provider is disabled. Enable Email/Password and Google in Firebase Authentication → Sign-in providers.',
    'auth/popup-blocked': 'The Google sign-in popup was blocked. Allow popups for this site and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled before an account was selected.',
    'auth/credential-already-in-use': 'That Google account is already linked to another Firebase account. No accounts were merged.',
    'auth/provider-already-linked': 'This sign-in method is already connected to your account.',
    'auth/network-request-failed': 'Firebase could not reach the authentication service. Check the network connection and deployment environment variables.',
    'auth/email-already-in-use': 'This email already has an account. Sign in instead, or use Google if that is how the account was created.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/weak-password': 'Use a stronger password with at least six characters.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/invalid-login-credentials': 'The email or password is incorrect.',
  }
  return messages[code] ?? (error instanceof Error ? error.message : 'Authentication failed. Please try again.')
}

export async function logout() {
  if (auth) await signOut(auth)
}
