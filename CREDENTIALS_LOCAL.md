# Luma — Local Credentials & Secrets Reference (MASKED)

> [!CAUTION]
> This file is gitignored. NEVER commit real production API keys or cleartext secrets to public repositories. All credentials shown below are masked for documentation purposes.

---

## 1. Firebase Project Credentials (Masked)
- **Firebase Project ID**: `luma-1d1cf`
- **Firebase Project Number**: `908483489382`
- **Realtime Database Instance**: `https://luma-1d1cf-default-rtdb.firebaseio.com`
- **Storage Bucket**: `luma-1d1cf.firebasestorage.app`
- **Web API Key**: `AIzaSyB_MASKED_KEY_HERE_4872X`
- **Web App ID**: `1:908483489382:web:78531bc789e902`
- **OAuth Support Email**: `svak3456@gmail.com`
- **Authorized OAuth Domains**:
  - `localhost`
  - `luma-1d1cf.web.app`
  - `luma-1d1cf.firebaseapp.com`
  - `luma-delta-navy.vercel.app`

---

## 2. WebRTC STUN & TURN Relay Credentials (Masked)
- **Primary STUN**: `stun:stun.l.google.com:19302`
- **Secondary STUN**: `stun:stun1.l.google.com:19302`
- **TURN Relay Server**: `turn:standard.relay.metered.ca:443?transport=tcp`
- **TURN Relay (TLS)**: `turns:standard.relay.metered.ca:5349?transport=tcp`
- **TURN Username**: `luma_relay_****`
- **TURN Credential**: `pass_****_secret`

---

## 3. Secret Injection Instructions

### Web
Place real secrets in `d:\Coding\WebchatCode\.env.local`:
```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=luma-1d1cf.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=luma-1d1cf
VITE_FIREBASE_STORAGE_BUCKET=luma-1d1cf.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_DATABASE_URL=https://luma-1d1cf-default-rtdb.firebaseio.com
VITE_TURN_URL=turn:standard.relay.metered.ca:443
VITE_TURN_USERNAME=...
VITE_TURN_CREDENTIAL=...
```

### iOS
Inject via environment or Xcode scheme configuration files (`Secrets.xcconfig`):
```xcconfig
FIREBASE_API_KEY = AIzaSy...
FIREBASE_DATABASE_URL = https:/$()/luma-1d1cf-default-rtdb.firebaseio.com
TURN_SERVER_URL = turn:standard.relay.metered.ca:443
TURN_USERNAME = ...
TURN_CREDENTIAL = ...
```

---

## 4. Key Rotation Policy
1. If the Web API Key or TURN secret is ever leaked, rotate immediately in the Google Cloud Console (Credentials) and the TURN provider dashboard.
2. Invalidate old Firebase Auth session tokens by revoking user sessions in Firebase Admin if suspicious activity occurs.
