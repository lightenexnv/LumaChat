import { child, onValue, ref, remove, serverTimestamp, set, type Unsubscribe } from 'firebase/database'
import { auth, database } from './firebase'

export const CALL_RING_TIMEOUT_MS = 60_000

export interface IncomingCall {
  callId: string
  callerId: string
  kind: 'video' | 'voice'
  callerProfile: { name: string; initials: string; color: string }
  createdAt: number
  state?: 'ringing'
}

export function subscribeIncomingCalls(uid: string, onCall: (call: IncomingCall | null) => void): Unsubscribe | null {
  const db = database
  if (!db) return null
  return onValue(ref(db, `incomingCalls/${uid}`), (snapshot) => {
    const values = snapshot.val() as Record<string, IncomingCall> | null
    const now = Date.now()
    const entries = Object.entries(values ?? {})
    const activeCalls = entries
      .filter(([, call]) => call?.state === 'ringing' && Number.isFinite(call.createdAt) && (now - call.createdAt) <= CALL_RING_TIMEOUT_MS && (call.createdAt - now) <= 60_000)
      .map(([, call]) => call)
      .sort((first, second) => second.createdAt - first.createdAt)
    const staleCallIds = entries
      .filter(([, call]) => call?.state !== 'ringing' || !Number.isFinite(call.createdAt) || (now - call.createdAt) > CALL_RING_TIMEOUT_MS)
      .map(([callId]) => callId)
    staleCallIds.forEach((callId) => {
      // Clean up stale ringing notification entry for this user only.
      // Never mutate calls/${callId}/state here as the call may have been accepted and is actively ongoing.
      void remove(ref(db, `incomingCalls/${uid}/${callId}`)).catch(() => undefined)
    })
    onCall(activeCalls[0] ?? null)
  })
}

export type GlareResolution = 
  | { action: 'accept_existing'; call: IncomingCall }
  | { action: 'proceed_new' }

/**
 * Resolves simultaneous cross-calling (glare) between two users.
 * If user A calls user B while an incoming ringing call from user B is already present,
 * the outgoing action automatically transforms into accepting user B's incoming call.
 */
export function resolveSimultaneousCall(
  peerUid: string,
  pendingIncomingCall: IncomingCall | null
): GlareResolution {
  if (
    pendingIncomingCall &&
    pendingIncomingCall.callerId === peerUid &&
    (!pendingIncomingCall.state || pendingIncomingCall.state === 'ringing')
  ) {
    return { action: 'accept_existing', call: pendingIncomingCall }
  }
  return { action: 'proceed_new' }
}

/**
 * Deterministically decides which call is canonical when two peers initiate calls to each other simultaneously.
 * The call created by the peer with the lexicographically smaller UID is canonical.
 */
export function isCanonicalCaller(myUid: string, peerUid: string): boolean {
  return myUid < peerUid
}

export async function declineIncomingCall(callId: string) {
  const db = database
  if (!db || !auth?.currentUser) return
  const callRef = ref(db, `calls/${callId}`)
  await set(child(callRef, 'state'), 'declined')
  await set(child(callRef, 'endedAt'), serverTimestamp())
  await remove(ref(db, `incomingCalls/${auth.currentUser.uid}/${callId}`))
  window.setTimeout(() => {
    void remove(ref(db, `calls/${callId}`)).catch(() => undefined)
  }, 15_000)
}

