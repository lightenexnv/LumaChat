import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { firestore } from './firebase'

// Application Server VAPID Public Key for Web Push (P-256 curve)
export const VAPID_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'

export interface PushSubscriptionData {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
  createdAt: number
  updatedAt: number
  deviceInfo?: string
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    document.referrer.includes('android-app://')
  )
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function getNotificationPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'default'
  return Notification.permission
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    return registration
  } catch (error) {
    console.error('Service Worker registration failed:', error)
    return null
  }
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  try {
    const registration = await navigator.serviceWorker.ready
    return await registration.pushManager.getSubscription()
  } catch {
    return null
  }
}

export async function subscribeToPush(user: User): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { success: false, error: 'Web Push is not supported on this browser or context.' }
  }

  try {
    // 1. Request user permission
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return {
        success: false,
        error:
          permission === 'denied'
            ? 'Notifications were denied. Please enable notifications for Luma in your iPhone / browser Settings.'
            : 'Notification permission was dismissed.',
      }
    }

    // 2. Ensure Service Worker is registered and ready
    let registration: ServiceWorkerRegistration | null | undefined = await navigator.serviceWorker.getRegistration()
    if (!registration) {
      registration = await registerServiceWorker()
    }
    if (!registration) {
      return { success: false, error: 'Service Worker could not be registered.' }
    }

    await navigator.serviceWorker.ready

    // 3. Create or get PushSubscription
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      const convertedVapidKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey,
      })
    }

    // 4. Save subscription to Firestore
    if (firestore && subscription) {
      const subJson = subscription.toJSON()
      if (subJson.endpoint && subJson.keys?.p256dh && subJson.keys?.auth) {
        // Hash endpoint to create a unique stable subscription ID
        const subId = btoa(subJson.endpoint).slice(-32).replace(/[^a-zA-Z0-9]/g, '_')
        const subDocRef = doc(firestore, 'users', user.uid, 'pushSubscriptions', subId)
        await setDoc(
          subDocRef,
          {
            endpoint: subJson.endpoint,
            keys: {
              p256dh: subJson.keys.p256dh,
              auth: subJson.keys.auth,
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deviceInfo: navigator.userAgent || 'Unknown device',
          },
          { merge: true }
        )
      }
    }

    return { success: true }
  } catch (err) {
    console.error('Failed to subscribe to Web Push:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Push subscription failed.' }
  }
}

export async function unsubscribeFromPush(user: User): Promise<boolean> {
  try {
    const subscription = await getExistingPushSubscription()
    if (subscription) {
      const subJson = subscription.toJSON()
      if (firestore && subJson.endpoint) {
        const subId = btoa(subJson.endpoint).slice(-32).replace(/[^a-zA-Z0-9]/g, '_')
        await deleteDoc(doc(firestore, 'users', user.uid, 'pushSubscriptions', subId)).catch(() => undefined)
      }
      await subscription.unsubscribe()
    }
    return true
  } catch {
    return false
  }
}

export async function triggerWebPushNotification(params: {
  recipientUid: string
  title: string
  body: string
  conversationId?: string
}): Promise<void> {
  if (!firestore || !params.recipientUid) return

  try {
    // 1. Fetch recipient's active push subscriptions from Firestore
    const subsRef = collection(firestore, 'users', params.recipientUid, 'pushSubscriptions')
    const snapshot = await getDocs(subsRef)
    if (snapshot.empty) return

    // 2. Call backend push delivery endpoint or process subscriptions
    const subscriptions = snapshot.docs.map((d) => d.data() as PushSubscriptionData)

    await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientUid: params.recipientUid,
        title: params.title,
        body: params.body,
        conversationId: params.conversationId,
        subscriptions,
      }),
    }).catch(() => {
      // Backend push attempt; silent fallback if serverless offline
    })
  } catch (err) {
    console.error('Push notification trigger error:', err)
  }
}

export function updateAppBadge(unreadCount: number): void {
  if (typeof navigator === 'undefined') return
  try {
    if (unreadCount > 0 && 'setAppBadge' in navigator) {
      void (navigator as unknown as { setAppBadge: (c: number) => Promise<void> }).setAppBadge(unreadCount).catch(() => undefined)
    } else if (unreadCount === 0 && 'clearAppBadge' in navigator) {
      void (navigator as unknown as { clearAppBadge: () => Promise<void> }).clearAppBadge().catch(() => undefined)
    }
  } catch {
    /* ignore unsupported */
  }
}
