function cloudinaryUrlFromStoragePath(storagePath: string) {
  return storagePath.startsWith('cloudinary:') ? storagePath.slice('cloudinary:'.length) : storagePath
}

export async function downloadCloudinaryAttachment(storagePath: string) {
  const url = cloudinaryUrlFromStoragePath(storagePath)
  if (!url.startsWith('https://')) throw new Error('The attachment URL is invalid.')
  const response = await fetch(url, { credentials: 'omit' })
  if (!response.ok) throw new Error(`Attachment download failed (${response.status}).`)
  return response.blob()
}
