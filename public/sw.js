/* global self, caches, fetch, Response, clients */

const CACHE = 'luma-shell-v2'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/manifest.json', '/icon.svg']))
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE) return caches.delete(key)
          })
        )
      ),
    ])
  )
})

// Web Push Event Handler
self.addEventListener('push', (event) => {
  let data = {
    title: 'Luma',
    body: 'New message received',
    icon: '/icon.svg',
    badge: '/icon.svg',
    conversationId: '',
    tag: 'luma-message',
  }

  if (event.data) {
    try {
      const json = event.data.json()
      data = { ...data, ...json }
    } catch {
      data.body = event.data.text() || data.body
    }
  }

  const notificationOptions = {
    body: data.body,
    icon: data.icon || '/icon.svg',
    badge: data.badge || '/icon.svg',
    tag: data.tag || (data.conversationId ? `luma-${data.conversationId}` : 'luma-message'),
    renotify: true,
    data: {
      conversationId: data.conversationId,
      url: data.conversationId ? `/?chat=${data.conversationId}` : '/',
      timestamp: Date.now(),
    },
    // Standard mobile notification preferences
    vibrate: [100, 50, 100],
    requireInteraction: false,
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Luma', notificationOptions)
  )
})

// Notification Click Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const conversationId = event.notification.data?.conversationId
  const targetUrl = event.notification.data?.url || (conversationId ? `/?chat=${conversationId}` : '/')

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Check if there is already a window/tab open with Luma
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (conversationId) {
            client.postMessage({
              type: 'NAVIGATE_CHAT',
              conversationId,
            })
          }
          return client.focus()
        }
      }
      // If no open client, open a new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    })
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone()
          void caches.open(CACHE).then((cache) => cache.put('/', clone))
          return response
        })
        .catch(() => caches.match('/') as Promise<Response>)
    )
    return
  }
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached ??
      fetch(event.request).then((response) => {
        const clone = response.clone()
        void caches.open(CACHE).then((cache) => cache.put(event.request, clone))
        return response
      })
    )
  )
})
