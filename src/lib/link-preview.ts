import { useEffect, useState } from 'react'

export interface LinkPreviewData {
  url: string
  originalUrl: string
  title?: string
  description?: string
  image?: string
  siteName?: string
  hostname: string
  favicon?: string
}

const URL_REGEX = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi

const previewCache = new Map<string, LinkPreviewData>()

export function extractUrls(text: string): string[] {
  if (!text) return []
  const matches = text.match(URL_REGEX) || []
  return matches.map((url) => {
    // Strip trailing punctuation if accidentally captured
    return url.replace(/[.,;:!?)]+$/, '')
  }).filter(Boolean)
}

export function extractFirstUrl(text: string): string | null {
  const urls = extractUrls(text)
  return urls.length > 0 ? urls[0] : null
}

export function getDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return urlStr
  }
}

export function getQuickPlatformMetadata(urlStr: string): Partial<LinkPreviewData> | null {
  try {
    const parsed = new URL(urlStr)
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const pathname = parsed.pathname

    // YouTube
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      let videoId: string | null = null
      if (hostname.includes('youtu.be')) {
        videoId = pathname.slice(1).split('/')[0] || null
      } else if (pathname.includes('/watch')) {
        videoId = parsed.searchParams.get('v')
      } else if (pathname.includes('/shorts/')) {
        videoId = pathname.split('/shorts/')[1]?.split('/')[0] || null
      }
      return {
        siteName: 'YouTube',
        hostname: 'youtube.com',
        title: videoId ? 'YouTube Video' : 'YouTube',
        description: 'Watch video on YouTube',
        image: videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : undefined,
        favicon: 'https://www.youtube.com/s/desktop/f3263009/img/favicon_144x144.png',
      }
    }

    // GitHub
    if (hostname === 'github.com') {
      const parts = pathname.split('/').filter(Boolean)
      if (parts.length >= 2) {
        const user = parts[0]
        const repo = parts[1]
        return {
          siteName: 'GitHub',
          hostname: 'github.com',
          title: `${user}/${repo}`,
          description: `GitHub repository by ${user}`,
          image: `https://opengraph.githubassets.com/1/${user}/${repo}`,
          favicon: 'https://github.githubassets.com/favicons/favicon.png',
        }
      }
      return {
        siteName: 'GitHub',
        hostname: 'github.com',
        title: 'GitHub: Let’s build from here',
        description: 'GitHub is where over 100 million developers shape the future of software.',
        favicon: 'https://github.githubassets.com/favicons/favicon.png',
      }
    }

    // Twitter / X
    if (hostname === 'twitter.com' || hostname === 'x.com') {
      return {
        siteName: 'X',
        hostname: 'x.com',
        title: 'X (formerly Twitter)',
        description: 'From breaking news and entertainment to sports and politics.',
        favicon: 'https://abs.twimg.com/favicons/twitter.3.ico',
      }
    }

    // Reddit
    if (hostname.includes('reddit.com')) {
      return {
        siteName: 'Reddit',
        hostname: 'reddit.com',
        title: 'Reddit - Dive into anything',
        description: 'Reddit is a network of communities where people can dive into their interests.',
        favicon: 'https://www.redditstatic.com/shreddit/assets/favicon/192x192.png',
      }
    }

    // Wikipedia
    if (hostname.includes('wikipedia.org')) {
      const title = decodeURIComponent(pathname.replace(/^\/wiki\//, '').replace(/_/g, ' '))
      return {
        siteName: 'Wikipedia',
        hostname: 'wikipedia.org',
        title: title ? `${title} - Wikipedia` : 'Wikipedia, the free encyclopedia',
        description: 'The free encyclopedia that anyone can edit.',
        favicon: 'https://en.wikipedia.org/static/favicon/wikipedia.ico',
      }
    }

    // Spotify
    if (hostname.includes('spotify.com')) {
      return {
        siteName: 'Spotify',
        hostname: 'spotify.com',
        title: 'Spotify - Web Player: Music for everyone',
        description: 'Play millions of songs and podcasts on your device.',
        favicon: 'https://open.spotifycdn.com/cdn/images/favicon32.b64ecc03.png',
      }
    }

    // Google Maps
    if (hostname.includes('maps.google.') || hostname.includes('google.com') && pathname.includes('/maps')) {
      return {
        siteName: 'Google Maps',
        hostname: 'maps.google.com',
        title: 'Google Maps',
        description: 'Find local businesses, view maps and get driving directions in Google Maps.',
        favicon: 'https://www.google.com/images/branding/product/ico/maps15_24dp.ico',
      }
    }

    return null
  } catch {
    return null
  }
}

export async function fetchLinkPreview(urlStr: string): Promise<LinkPreviewData> {
  const normalized = urlStr.trim()
  if (previewCache.has(normalized)) {
    return previewCache.get(normalized)!
  }

  const hostname = getDomain(normalized)
  const quick = getQuickPlatformMetadata(normalized)

  const fallback: LinkPreviewData = {
    url: normalized,
    originalUrl: normalized,
    hostname,
    siteName: quick?.siteName || hostname,
    title: quick?.title || hostname,
    description: quick?.description || normalized,
    image: quick?.image,
    favicon: quick?.favicon || `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3500)
    const response = await fetch(`https://api.microlink.io?url=${encodeURIComponent(normalized)}`, {
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (response.ok) {
      const payload = await response.json()
      if (payload.status === 'success' && payload.data) {
        const data = payload.data
        const result: LinkPreviewData = {
          url: data.url || normalized,
          originalUrl: normalized,
          hostname: getDomain(data.url || normalized),
          title: data.title || quick?.title || hostname,
          description: data.description || quick?.description || normalized,
          siteName: data.publisher || quick?.siteName || hostname,
          image: data.image?.url || quick?.image,
          favicon: data.logo?.url || quick?.favicon || `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
        }
        previewCache.set(normalized, result)
        return result
      }
    }
  } catch {
    // If external fetch fails/times out, use the fallback
  }

  previewCache.set(normalized, fallback)
  return fallback
}

export function useLinkPreview(url: string | null): { preview: LinkPreviewData | null; loading: boolean } {
  const [preview, setPreview] = useState<LinkPreviewData | null>(() => (url && previewCache.has(url) ? previewCache.get(url)! : null))
  const [loading, setLoading] = useState<boolean>(Boolean(url && !previewCache.has(url)))

  useEffect(() => {
    if (!url) {
      setPreview(null)
      setLoading(false)
      return
    }

    if (previewCache.has(url)) {
      setPreview(previewCache.get(url)!)
      setLoading(false)
      return
    }

    // Set initial quick metadata immediately if available
    const quick = getQuickPlatformMetadata(url)
    if (quick) {
      const initial: LinkPreviewData = {
        url,
        originalUrl: url,
        hostname: getDomain(url),
        siteName: quick.siteName || getDomain(url),
        title: quick.title || getDomain(url),
        description: quick.description,
        image: quick.image,
        favicon: quick.favicon || `https://www.google.com/s2/favicons?domain=${getDomain(url)}&sz=64`,
      }
      setPreview(initial)
    }

    let active = true
    setLoading(true)

    void fetchLinkPreview(url).then((res) => {
      if (active) {
        setPreview(res)
        setLoading(false)
      }
    })

    return () => {
      active = false
    }
  }, [url])

  return { preview, loading }
}
