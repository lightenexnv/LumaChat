export const GATEWAY_SESSION_KEY = 'luma:verified-session'

const gatewayAnswer = 'gune'

export type GatewayStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserSessionStorage(): GatewayStorage | null {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage } catch { return null }
}

export function hasGatewayVerification(storage: GatewayStorage | null = browserSessionStorage()) {
  try { return storage?.getItem(GATEWAY_SESSION_KEY) === 'verified' } catch { return false }
}

export function markGatewayVerified(storage: GatewayStorage | null = browserSessionStorage()) {
  try { storage?.setItem(GATEWAY_SESSION_KEY, 'verified') } catch { /* Verification applies for the active session */ }
}

export function clearGatewayVerification(storage: GatewayStorage | null = browserSessionStorage()) {
  try { storage?.removeItem(GATEWAY_SESSION_KEY) } catch { /* noop */ }
}

export function normalizeGatewayAnswer(value: string) {
  return value.trim().toLowerCase()
}

export function isGatewayAnswerCorrect(value: string) {
  return normalizeGatewayAnswer(value) === gatewayAnswer
}

export function createGatewayChallenge(random: () => number = Math.random) {
  const letters = gatewayAnswer.toUpperCase().split('')
  for (let index = letters.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[letters[index], letters[swapIndex]] = [letters[swapIndex], letters[index]]
  }
  if (letters.join('') === gatewayAnswer.toUpperCase()) [letters[0], letters[1]] = [letters[1], letters[0]]
  return letters
}
