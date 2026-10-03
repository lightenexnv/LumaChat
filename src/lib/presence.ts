import { onDisconnect, onValue, ref, serverTimestamp, set, type Unsubscribe } from 'firebase/database'
import { database } from './firebase'

export interface PresenceState {
  online: boolean
  lastSeen?: number
}

export async function setPresence(uid: string, online: boolean) {
  if (!database) return
  const presenceRef = ref(database, `presence/${uid}`)
  await set(presenceRef, { online, lastSeen: serverTimestamp() })
  if (online) await onDisconnect(presenceRef).set({ online: false, lastSeen: serverTimestamp() })
}

export function subscribePresence(uid: string, onPresence: (presence: PresenceState) => void): Unsubscribe | null {
  if (!database) return null
  return onValue(ref(database, `presence/${uid}`), (snapshot) => {
    const value = snapshot.val() as { online?: unknown; lastSeen?: unknown } | null
    const lastSeen = typeof value?.lastSeen === 'number' ? value.lastSeen : undefined
    onPresence({ online: value?.online === true, lastSeen })
  })
}
