import { collection, doc, onSnapshot, runTransaction, setDoc, query, where, type Unsubscribe } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { firestore } from './firebase'
import { createPairingSecret, hashText } from './crypto'
import type { UserProfile } from './profiles'

const inviteTtlMs = 10 * 60 * 1000
const localSecretPrefix = 'luma:invite-secret:'

function conversationIdFor(first: string, second: string) {
  return [first, second].sort().join('_')
}

function profileFields(profile: UserProfile) {
  return { name: profile.displayName, handle: profile.handle, initials: profile.initials, color: profile.color, photoURL: profile.photoURL ?? null }
}

export async function createInvite(profile: UserProfile) {
  if (!firestore) throw new Error('Firebase is not configured.')
  const secret = createPairingSecret()
  const codeHash = await hashText(secret)
  const now = Date.now()
  await setDoc(doc(firestore, 'invites', codeHash), {
    ownerId: profile.uid,
    ownerProfile: profileFields(profile),
    createdAt: now,
    expiresAt: now + inviteTtlMs,
    acceptedBy: null,
    acceptedProfile: null,
  })
  localStorage.setItem(`${localSecretPrefix}${codeHash}`, secret)
  return { secret, codeHash, expiresAt: now + inviteTtlMs }
}

export async function acceptInvite(rawCode: string, user: User, profile: UserProfile) {
  if (!firestore) throw new Error('Firebase is not configured.')
  const secret = inviteCodeFromPayload(rawCode)
  const codeHash = await hashText(secret)
  const inviteRef = doc(firestore, 'invites', codeHash)
  const invite = await runTransaction(firestore, async (transaction) => {
    const inviteSnapshot = await transaction.get(inviteRef)
    if (!inviteSnapshot.exists()) throw new Error('That invite code is invalid or expired.')
    const data = inviteSnapshot.data()
    if (data.expiresAt < Date.now() || data.acceptedBy) throw new Error('That invite code is no longer available.')
    if (data.ownerId === user.uid) throw new Error('You cannot accept your own invite.')
    transaction.update(inviteRef, { acceptedBy: user.uid, acceptedProfile: profileFields(profile) })
    return data
  })
  const conversationId = conversationIdFor(invite.ownerId as string, user.uid)
  await setDoc(doc(firestore, 'conversations', conversationId), { memberIds: [invite.ownerId, user.uid], updatedAt: Date.now() }, { merge: true })
  await setDoc(doc(firestore, 'users', user.uid, 'contacts', invite.ownerId as string), {
    uid: invite.ownerId,
    inviteId: codeHash,
    ...invite.ownerProfile,
    conversationId,
    pairingSecret: secret,
    createdAt: Date.now(),
  })
}

export function subscribeOwnedInvites(profile: UserProfile, onError: (error: Error) => void): Unsubscribe | null {
  const db = firestore
  if (!db) return null
  const invitesQuery = query(collection(db, 'invites'), where('ownerId', '==', profile.uid))
  return onSnapshot(invitesQuery, async (snapshot) => {
    for (const inviteSnapshot of snapshot.docs) {
      const invite = inviteSnapshot.data()
      if (!invite.acceptedBy || invite.expiresAt < Date.now()) continue
      const acceptedProfile = invite.acceptedProfile as { name: string; handle: string; initials: string; color: string; photoURL?: string | null } | null
      if (!acceptedProfile) continue
      const secret = localStorage.getItem(`${localSecretPrefix}${inviteSnapshot.id}`)
      if (!secret) continue
      const conversationId = conversationIdFor(profile.uid, invite.acceptedBy as string)
      await setDoc(doc(db, 'conversations', conversationId), { memberIds: [profile.uid, invite.acceptedBy], updatedAt: Date.now() }, { merge: true })
      await setDoc(doc(db, 'users', profile.uid, 'contacts', invite.acceptedBy as string), {
        uid: invite.acceptedBy,
        inviteId: inviteSnapshot.id,
        ...acceptedProfile,
        conversationId,
        pairingSecret: secret,
        createdAt: Date.now(),
      }, { merge: true })
    }
  }, (error) => onError(error))
}

export function inviteUrl(secret: string) {
  return `luma://invite/${secret.toUpperCase()}`
}

export function inviteCodeFromPayload(rawCode: string) {
  const trimmed = rawCode.trim().toUpperCase()
  const qrMatch = trimmed.match(/(?:luma:\/\/invite\/|invite\/|#invite=)([A-Z0-9]{6})/i)
  const cleaned = (qrMatch?.[1] ?? trimmed).replace(/[^A-Z0-9]/gi, '').toUpperCase()
  return cleaned.slice(0, 6)
}
