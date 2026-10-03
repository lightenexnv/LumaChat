import { collection, deleteDoc, doc, getDoc, onSnapshot, setDoc, updateDoc, type Unsubscribe } from 'firebase/firestore'
import { updateProfile, type User } from 'firebase/auth'
import { auth, firestore } from './firebase'
import { hashText } from './crypto'
import type { Friend } from '../types'

export interface UserProfile {
  uid: string
  displayName: string
  handle: string
  initials: string
  color: string
  photoURL?: string
  statusText?: string
  createdAt: number
  lastSeen: number
}

type ContactSnapshot = {
  uid: string
  name: string
  nickname?: string
  handle: string
  initials: string
  color: string
  photoURL?: string
  conversationId: string
  pairingSecret: string
  inviteId?: string
  pinned?: boolean
  clearedAt?: number
}

type ContactProfileSnapshot = Pick<UserProfile, 'displayName' | 'handle' | 'initials' | 'color' | 'photoURL'>

const colors = ['#dca6bf', '#9cc8bc', '#a8b9d5', '#d7b18e', '#b3a2ca']
const defaultDisplayName = 'New connection'

function colorForUid(uid: string) {
  const hash = Array.from(uid).reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 7)
  return colors[hash % colors.length] ?? colors[0]
}

export function defaultProfile(user: User): UserProfile {
  const name = user.displayName?.trim() || defaultDisplayName
  const isGunnu = name.toLowerCase().includes('gunnu')
  const photo = user.photoURL || (isGunnu ? '/avatars/gunnu_verma.png' : undefined)
  return { uid: user.uid, displayName: name, handle: `@${user.uid.slice(0, 8)}`, initials: name.slice(0, 1).toUpperCase(), color: colorForUid(user.uid), ...(photo ? { photoURL: photo } : {}), statusText: 'Express yourself in emoji!', createdAt: Date.now(), lastSeen: Date.now() }
}

function profileFromSnapshot(user: User, data: Record<string, unknown>, fallback: UserProfile): UserProfile {
  const authDisplayName = user.displayName?.trim()
  const storedDisplayName = typeof data.displayName === 'string' ? data.displayName.trim() : ''
  // Profiles created before the user chose a name contain the placeholder. Do
  // not let that old value win over the name Firebase Auth already knows.
  const displayName = storedDisplayName && storedDisplayName !== defaultDisplayName
    ? storedDisplayName
    : authDisplayName || storedDisplayName || fallback.displayName
  const initials = typeof data.initials === 'string' && data.initials.trim() && displayName === storedDisplayName
    ? data.initials
    : displayName.slice(0, 1).toUpperCase()
  const statusText = typeof data.statusText === 'string' ? data.statusText : fallback.statusText || 'Express yourself in emoji!'

  const isGunnu = displayName.toLowerCase().includes('gunnu')
  const photo = typeof data.photoURL === 'string' && data.photoURL ? data.photoURL : user.photoURL ? user.photoURL : (isGunnu ? '/avatars/gunnu_verma.png' : undefined)

  return {
    uid: user.uid,
    displayName,
    handle: typeof data.handle === 'string' && data.handle.trim() ? data.handle : fallback.handle,
    initials,
    color: typeof data.color === 'string' && data.color.trim() ? data.color : fallback.color,
    ...(photo ? { photoURL: photo } : {}),
    statusText,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : fallback.createdAt,
    lastSeen: typeof data.lastSeen === 'number' ? data.lastSeen : fallback.lastSeen,
  }
}

export async function ensureUserProfile(user: User) {
  if (!firestore) throw new Error('Firebase is not configured.')
  const profile = defaultProfile(user)
  const profileRef = doc(firestore, 'users', user.uid)
  const snapshot = await getDoc(profileRef)
  if (!snapshot.exists()) {
    await setDoc(profileRef, profile)
    return profile
  }

  const existing = profileFromSnapshot(user, snapshot.data(), profile)
  const storedDisplayName = typeof snapshot.data().displayName === 'string' ? snapshot.data().displayName.trim() : ''
  if (existing.displayName !== storedDisplayName || !snapshot.data().uid) {
    await setDoc(profileRef, existing, { merge: true })
  }
  return existing
}

export async function saveUserProfile(profile: UserProfile): Promise<UserProfile> {
  if (!firestore) throw new Error('Firebase is not configured.')
  const displayName = profile.displayName.trim()
  const initials = displayName ? displayName.slice(0, 1).toUpperCase() : profile.initials
  const isGunnu = displayName.toLowerCase().includes('gunnu')
  const photoURL = profile.photoURL || (isGunnu ? '/avatars/gunnu_verma.png' : undefined)
  const savedProfile: UserProfile = {
    ...profile,
    displayName,
    initials,
    ...(photoURL ? { photoURL } : {}),
    lastSeen: Date.now(),
  }
  await setDoc(doc(firestore, 'users', profile.uid), savedProfile, { merge: true })
  if (auth?.currentUser) {
    try {
      await updateProfile(auth.currentUser, {
        displayName,
        ...(photoURL ? { photoURL } : {}),
      })
    } catch {
      // Non-fatal
    }
  }
  return savedProfile
}

export function mergeContactProfile(contactId: string, contactData: ContactSnapshot, profileData?: ContactProfileSnapshot): Friend {
  const liveName = profileData?.displayName?.trim()
  const snapshotName = contactData.name?.trim()
  const name = liveName && liveName !== defaultDisplayName ? liveName : snapshotName || liveName || defaultDisplayName
  const isGunnu = name.toLowerCase().includes('gunnu')
  const photoURL = profileData?.photoURL || contactData.photoURL || (isGunnu ? '/avatars/gunnu_verma.png' : undefined)
  return {
    id: contactId,
    name,
    nickname: contactData.nickname?.trim() || undefined,
    handle: profileData?.handle || contactData.handle,
    initials: profileData?.initials || contactData.initials,
    color: profileData?.color || contactData.color,
    photoURL,
    online: false,
    verified: true,
    conversationId: contactData.conversationId,
    pairingSecret: contactData.pairingSecret,
    pinned: contactData.pinned,
    clearedAt: contactData.clearedAt,
  }
}

export async function updateContactSettings(uid: string, contactId: string, settings: { pinned?: boolean; clearedAt?: number; nickname?: string }) {
  if (!firestore) throw new Error('Firebase is not configured.')
  await setDoc(doc(firestore, 'users', uid, 'contacts', contactId), settings, { merge: true })
}

export async function deleteContact(uid: string, contactId: string) {
  if (!firestore) throw new Error('Firebase is not configured.')
  await deleteDoc(doc(firestore, 'users', uid, 'contacts', contactId))
}

export function subscribeContacts(uid: string, onContacts: (contacts: Friend[]) => void, onError: (error: Error) => void): Unsubscribe | null {
  const db = firestore
  if (!db) return null
  const contactDocuments = new Map<string, ContactSnapshot>()
  const liveProfiles = new Map<string, ContactProfileSnapshot>()
  const profileUnsubscribes = new Map<string, Unsubscribe>()
  const inviteMigrations = new Set<string>()
  let contactOrder: string[] = []
  let stopped = false

  const emitContacts = () => {
    if (stopped) return
    onContacts(contactOrder.flatMap((contactId) => {
      const contact = contactDocuments.get(contactId)
      return contact ? [mergeContactProfile(contactId, contact, liveProfiles.get(contactId))] : []
    }))
  }

  const subscribeToContactProfile = (contactId: string) => {
    if (stopped || profileUnsubscribes.has(contactId)) return
    const profileRef = doc(db, 'users', contactId)
    const unsubscribe = onSnapshot(profileRef, (profileSnapshot) => {
      if (profileSnapshot.exists()) {
        const profile = profileSnapshot.data()
        const displayName = typeof profile.displayName === 'string' ? profile.displayName.trim() : ''
        const handle = typeof profile.handle === 'string' ? profile.handle.trim() : ''
        const initials = typeof profile.initials === 'string' ? profile.initials.trim() : ''
        const color = typeof profile.color === 'string' ? profile.color.trim() : ''
        if (displayName && handle && initials && color) {
          liveProfiles.set(contactId, {
            displayName,
            handle,
            initials,
            color,
            photoURL: typeof profile.photoURL === 'string' ? profile.photoURL : undefined,
          })
        } else {
          liveProfiles.delete(contactId)
        }
      } else {
        liveProfiles.delete(contactId)
      }
      emitContacts()
    }, (error) => {
      profileUnsubscribes.delete(contactId)
      liveProfiles.delete(contactId)
      onError(error instanceof Error ? error : new Error('Contact profile could not be synchronized.'))
      emitContacts()
    })
    profileUnsubscribes.set(contactId, unsubscribe)
  }

  const synchronizeContactProfile = async (contactId: string, contact: ContactSnapshot) => {
    if (stopped || !contact.pairingSecret) return
    try {
      const expectedInviteId = await hashText(contact.pairingSecret)
      if (stopped || !contactDocuments.has(contactId)) return
      if (contact.inviteId !== expectedInviteId) {
        if (!inviteMigrations.has(contactId)) {
          inviteMigrations.add(contactId)
          try {
            await setDoc(doc(db, 'users', uid, 'contacts', contactId), { inviteId: expectedInviteId }, { merge: true })
          } catch (error) {
            inviteMigrations.delete(contactId)
            onError(error instanceof Error ? error : new Error('Contact profile could not be synchronized.'))
          }
        }
        return
      }
      subscribeToContactProfile(contactId)
    } catch (error) {
      onError(error instanceof Error ? error : new Error('Contact profile could not be synchronized.'))
    }
  }

  const unsubscribeContacts = onSnapshot(collection(db, 'users', uid, 'contacts'), (snapshot) => {
    const nextIds = snapshot.docs.map((contact) => contact.id)
    const nextIdSet = new Set(nextIds)
    contactOrder = nextIds
    for (const contact of snapshot.docs) {
      const data = contact.data()
      contactDocuments.set(contact.id, {
        uid: data.uid as string,
        name: data.name as string,
        handle: data.handle as string,
        initials: data.initials as string,
        color: data.color as string,
        photoURL: typeof data.photoURL === 'string' ? data.photoURL : undefined,
        conversationId: data.conversationId as string,
        pairingSecret: data.pairingSecret as string,
        inviteId: typeof data.inviteId === 'string' ? data.inviteId : undefined,
        pinned: data.pinned === true,
        clearedAt: typeof data.clearedAt === 'number' ? data.clearedAt : undefined,
      })
      void synchronizeContactProfile(contact.id, contactDocuments.get(contact.id) as ContactSnapshot)
    }
    for (const [contactId, unsubscribe] of profileUnsubscribes) {
      if (nextIdSet.has(contactId)) continue
      unsubscribe()
      profileUnsubscribes.delete(contactId)
      contactDocuments.delete(contactId)
      liveProfiles.delete(contactId)
    }
    emitContacts()
  }, (error) => onError(error))

  return () => {
    stopped = true
    unsubscribeContacts()
    for (const unsubscribe of profileUnsubscribes.values()) unsubscribe()
    profileUnsubscribes.clear()
  }
}
