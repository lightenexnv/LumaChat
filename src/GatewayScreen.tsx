import { useEffect, useRef, useState } from 'react'
import { isGatewayAnswerCorrect, markGatewayVerified } from './lib/gateway'

const SAMPLE_CAPTCHAS = ['wvssrq', 'bmyqtg', 'wxrzvd', 'kmyspw', 'tvyzqn', 'fwnrgd', 'qsyvxb', 'uvsmrw']

export default function GatewayScreen({ onVerified }: { onVerified: () => void }) {
  const [step, setStep] = useState<1 | 2>(1)
  const [isChecking, setIsChecking] = useState(false)
  const [challengeText, setChallengeText] = useState(() => SAMPLE_CAPTCHAS[Math.floor(Math.random() * SAMPLE_CAPTCHAS.length)])
  const [answer, setAnswer] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Draw the authentic distorted captcha matching Image 2
  function renderCaptchaCanvas(text: string) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height

    // Background
    ctx.fillStyle = '#fcfbfa'
    ctx.fillRect(0, 0, width, height)

    // Draw background tangled red squiggles
    for (let i = 0; i < 24; i++) {
      ctx.beginPath()
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(218, 58, 42, 0.78)' : 'rgba(238, 78, 62, 0.62)'
      ctx.lineWidth = 1.2 + Math.random() * 1.4

      const startX = Math.random() * width
      const startY = Math.random() * height
      ctx.moveTo(startX, startY)

      const cp1x = Math.random() * width
      const cp1y = Math.random() * height
      const cp2x = Math.random() * width
      const cp2y = Math.random() * height
      const endX = Math.random() * width
      const endY = Math.random() * height

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY)
      ctx.stroke()
    }

    // Draw wavy distorted cursive graffiti letters in dusty slate-blue (#5c8699)
    const letters = text.split('')
    const letterSpacing = (width - 44) / letters.length

    letters.forEach((char, idx) => {
      ctx.save()
      const x = 20 + idx * letterSpacing + (Math.random() * 4 - 2)
      const y = height / 2 + 12 + Math.sin(idx * 1.6) * 10
      const angle = Math.sin(idx * 1.8) * 0.24 + (Math.random() * 0.2 - 0.1)

      ctx.translate(x, y)
      ctx.rotate(angle)

      ctx.font = 'italic bold 44px "Brush Script MT", "Segoe Print", "Comic Sans MS", "Caveat", cursive, sans-serif'
      ctx.fillStyle = '#5c8699'
      ctx.strokeStyle = '#4b7588'
      ctx.lineWidth = 1.4
      ctx.shadowColor = 'rgba(92, 134, 153, 0.35)'
      ctx.shadowBlur = 3
      ctx.shadowOffsetX = 1
      ctx.shadowOffsetY = 1

      ctx.fillText(char, 0, 0)
      ctx.strokeText(char, 0, 0)
      ctx.restore()
    })

    // Additional foreground red squiggly lines crossing the letters
    for (let i = 0; i < 10; i++) {
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(224, 62, 46, 0.72)'
      ctx.lineWidth = 1 + Math.random() * 1.2
      const startX = Math.random() * width
      const startY = Math.random() * height
      ctx.moveTo(startX, startY)
      const cp1x = Math.random() * width
      const cp1y = Math.random() * height
      const endX = Math.random() * width
      const endY = Math.random() * height
      ctx.quadraticCurveTo(cp1x, cp1y, endX, endY)
      ctx.stroke()
    }
  }

  useEffect(() => {
    if (step === 2) {
      renderCaptchaCanvas(challengeText)
      inputRef.current?.focus()
    }
  }, [step, challengeText])

  function handleCheckboxClick() {
    if (isChecking) return
    setIsChecking(true)
    // Authentic spinner delay before revealing challenge step 2
    window.setTimeout(() => {
      setIsChecking(false)
      setStep(2)
    }, 550)
  }

  function handleRefreshChallenge() {
    const nextIndex = Math.floor(Math.random() * SAMPLE_CAPTCHAS.length)
    const nextText = SAMPLE_CAPTCHAS[nextIndex]
    setChallengeText(nextText)
    setAnswer('')
    setErrorMessage('')
    inputRef.current?.focus()
  }

  function handlePlayAudio() {
    if (typeof window === 'undefined') return
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const spoken = challengeText.split('').join(' ')
      const utterance = new SpeechSynthesisUtterance(spoken)
      utterance.rate = 0.75
      utterance.pitch = 0.95
      window.speechSynthesis.speak(utterance)
    }
  }

  function handleOpenApp(event: React.MouseEvent) {
    event.preventDefault()
    if (typeof window === 'undefined') return
    const userAgent = navigator.userAgent || ''
    const isAndroid = /android/i.test(userAgent)
    const isIOS = /iPad|iPhone|iPod/.test(userAgent)

    if (isAndroid) {
      window.location.href = 'intent://www.youtube.com/#Intent;package=com.google.android.youtube;scheme=https;end'
    } else if (isIOS) {
      window.location.href = 'youtube://'
      window.setTimeout(() => {
        window.location.href = 'https://m.youtube.com/'
      }, 750)
    } else {
      window.location.href = 'https://www.youtube.com/'
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!answer.trim()) return

    if (!isGatewayAnswerCorrect(answer)) {
      setErrorMessage('Incorrect captcha. Please try again.')
      setAnswer('')
      handleRefreshChallenge()
      return
    }

    markGatewayVerified()
    onVerified()
  }

  return (
    <div className="yt-gateway-container" role="dialog" aria-modal="true" aria-label="YouTube verification check">
      {/* YouTube mobile top header matching screenshot */}
      <header className="yt-gateway-header">
        <div className="yt-gateway-header-left">
          <div className="yt-logo-badge" aria-label="YouTube">
            <svg viewBox="0 0 24 24" className="yt-play-icon" aria-hidden="true">
              <path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z" />
              <path fill="#FFFFFF" d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
            <span className="yt-logo-text">YouTube</span>
          </div>
        </div>

        <div className="yt-gateway-header-right">
          <button type="button" className="yt-icon-btn" aria-label="Search">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <button type="button" className="yt-icon-btn" aria-label="More options">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="#FFFFFF">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
          <a
            href="https://www.youtube.com/"
            onClick={handleOpenApp}
            className="yt-open-app-btn"
            aria-label="Open App"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>Open App</span>
          </a>
        </div>
      </header>
      <div className="yt-header-purple-line" />

      {/* Main white screen with reCAPTCHA widget */}
      <main className="yt-gateway-main">
        {step === 1 ? (
          /* Step 1: "I'm not a robot" reCAPTCHA v2 box matching Image 1 */
          <div className="recaptcha-step1-card">
            <div className="recaptcha-step1-left">
              <button
                type="button"
                className={`recaptcha-checkbox ${isChecking ? 'checking' : ''}`}
                onClick={handleCheckboxClick}
                aria-label="I'm not a robot checkbox"
                disabled={isChecking}
              >
                {isChecking && <div className="recaptcha-spinner" />}
              </button>
              <span className="recaptcha-label">I'm not a robot</span>
            </div>

            <div className="recaptcha-step1-right">
              <div className="recaptcha-logo-icon" aria-hidden="true">
                <svg viewBox="0 0 32 32" width="28" height="28">
                  {/* Blue top-right curved arrow */}
                  <path fill="#1a73e8" d="M16 4a12 12 0 0 1 11.3 8h-4.3l6 8 6-8h-4.2A15.9 15.9 0 0 0 16 0C9.6 0 4.1 3.8 1.6 9.3l3.7 1.9A11.9 11.9 0 0 1 16 4z" />
                  {/* Silver bottom-left curved arrow */}
                  <path fill="#9aa0a6" d="M16 28a12 12 0 0 1-11.3-8h4.3l-6-8-6 8h4.2A15.9 15.9 0 0 0 16 32c6.4 0 11.9-3.8 14.4-9.3l-3.7-1.9A11.9 11.9 0 0 1 16 28z" />
                </svg>
              </div>
              <span className="recaptcha-brand-text">reCAPTCHA</span>
            </div>
          </div>
        ) : (
          /* Step 2: Distorted Captcha Challenge matching Image 2 */
          <div className="recaptcha-step2-card">
            <div className="recaptcha-step2-title">Enter the text below</div>

            <div className="recaptcha-challenge-box">
              <canvas
                ref={canvasRef}
                width={276}
                height={96}
                className="recaptcha-canvas"
                aria-label="Captcha challenge image"
              />

              <div className="recaptcha-toolbar">
                <button
                  type="button"
                  className="recaptcha-tool-btn"
                  onClick={handlePlayAudio}
                  aria-label="Play audio challenge"
                  title="Play audio challenge"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#222222" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                </button>

                <button
                  type="button"
                  className="recaptcha-tool-btn"
                  onClick={handleRefreshChallenge}
                  aria-label="Get a new challenge"
                  title="Get a new challenge"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#222222" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                  </svg>
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="recaptcha-form">
              <div className="recaptcha-input-row">
                <input
                  ref={inputRef}
                  type="text"
                  value={answer}
                  onChange={(e) => {
                    setAnswer(e.target.value)
                    if (errorMessage) setErrorMessage('')
                  }}
                  placeholder="Answer"
                  className={`recaptcha-input ${errorMessage ? 'has-error' : ''}`}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
                <button type="submit" className="recaptcha-submit-btn">
                  Submit
                </button>
              </div>

              {errorMessage && (
                <div className="recaptcha-error-text" role="alert">
                  {errorMessage}
                </div>
              )}
            </form>
          </div>
        )}
      </main>
    </div>
  )
}
