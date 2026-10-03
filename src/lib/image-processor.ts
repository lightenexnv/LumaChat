export interface ProcessedCallPhoto {
  thumbDataUrl: string
  file: File
}

/**
 * Asynchronously captures and compresses a high-resolution snapshot from video elements
 * using OffscreenCanvas or async canvas buffers to keep WebRTC main thread smooth.
 */
export async function processCallPhotoAsync(
  remoteVideo: HTMLVideoElement,
  localVideo?: HTMLVideoElement | null
): Promise<ProcessedCallPhoto | null> {
  const minReadyState = typeof HTMLMediaElement !== 'undefined' ? HTMLMediaElement.HAVE_CURRENT_DATA : 2
  if (!remoteVideo || remoteVideo.readyState < minReadyState || !remoteVideo.videoWidth || !remoteVideo.videoHeight) {
    return null
  }

  const width = remoteVideo.videoWidth
  const height = remoteVideo.videoHeight

  const isOffscreenSupported = typeof OffscreenCanvas !== 'undefined'
  const canvas = isOffscreenSupported
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) return null

  // Render remote video stream frame
  ctx.drawImage(remoteVideo, 0, 0, width, height)

  // Render local preview PiP overlay if active and visible
  if (localVideo && localVideo.readyState >= minReadyState && localVideo.videoWidth && localVideo.videoHeight && localVideo.offsetParent !== null) {
    const tileWidth = Math.round(width * 0.24)
    const tileHeight = Math.round(tileWidth * (localVideo.videoHeight / localVideo.videoWidth))
    const x = width - tileWidth - Math.round(width * 0.035)
    const y = height - tileHeight - Math.round(height * 0.035)
    ctx.save()
    ctx.fillStyle = '#111b21'
    ctx.strokeStyle = 'rgba(255,255,255,.8)'
    ctx.lineWidth = Math.max(3, Math.round(width / 320))
    ctx.beginPath()
    if (typeof (ctx as CanvasRenderingContext2D).roundRect === 'function') {
      (ctx as CanvasRenderingContext2D).roundRect(x - 4, y - 4, tileWidth + 8, tileHeight + 8, Math.round(width * 0.018))
    } else {
      ctx.rect(x - 4, y - 4, tileWidth + 8, tileHeight + 8)
    }
    ctx.fill()
    ctx.stroke()
    ctx.clip()
    ctx.drawImage(localVideo, x, y, tileWidth, tileHeight)
    ctx.restore()
  }

  let blob: Blob | null = null
  let thumbDataUrl = ''

  if (canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
    const thumbWidth = Math.max(80, Math.round(width * 0.18))
    const thumbHeight = Math.max(60, Math.round(height * 0.18))
    const thumbCanvas = new OffscreenCanvas(thumbWidth, thumbHeight)
    const thumbCtx = thumbCanvas.getContext('2d')
    if (thumbCtx) {
      thumbCtx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight)
      const thumbBlob = await thumbCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.45 })
      thumbDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(String(reader.result ?? ''))
        reader.readAsDataURL(thumbBlob)
      })
    }
  } else {
    thumbDataUrl = canvas.toDataURL('image/jpeg', 0.45)
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  }

  if (!blob) return null

  const file = new File([blob], `luma-call-${Date.now()}.jpg`, { type: 'image/jpeg' })
  return { thumbDataUrl, file }
}
