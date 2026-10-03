# Luma — Configuration Matrix & Environment Variables

## 1. Overview
This matrix details all configuration variables, keys, and endpoints required across Web, iOS, and Android platforms.

---

## 2. Platform Configuration Matrix

| Variable Name | Purpose | Web (`.env.local`) | iOS (`LumaConfig.plist` / `.xcconfig`) | Android (`local.properties` / buildConfig) |
| :--- | :--- | :--- | :--- | :--- |
| `FIREBASE_API_KEY` | Firebase Web API Key | `VITE_FIREBASE_API_KEY` | `FIREBASE_API_KEY` | `firebase_api_key` |
| `FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain | `VITE_FIREBASE_AUTH_DOMAIN` | `FIREBASE_AUTH_DOMAIN` | `firebase_auth_domain` |
| `FIREBASE_PROJECT_ID` | Project Identifier (`luma-1d1cf`) | `VITE_FIREBASE_PROJECT_ID` | `FIREBASE_PROJECT_ID` | `firebase_project_id` |
| `FIREBASE_STORAGE_BUCKET`| Storage Bucket (`luma-1d1cf.firebasestorage.app`) | `VITE_FIREBASE_STORAGE_BUCKET` | `FIREBASE_STORAGE_BUCKET` | `firebase_storage_bucket` |
| `FIREBASE_DATABASE_URL` | Realtime DB URL (`https://luma-1d1cf-default-rtdb.firebaseio.com`) | `VITE_FIREBASE_DATABASE_URL` | `FIREBASE_DATABASE_URL` | `firebase_database_url` |
| `FIREBASE_MESSAGING_SENDER_ID`| FCM Sender ID | `VITE_FIREBASE_MESSAGING_SENDER_ID` | `FCM_SENDER_ID` | `gcm_defaultSenderId` |
| `FIREBASE_APP_ID` | Client App Identifier | `VITE_FIREBASE_APP_ID` | `FIREBASE_APP_ID` | `google_app_id` |
| `STUN_SERVER_URLS` | Public STUN Servers | `stun:stun.l.google.com:19302` | `stun:stun.l.google.com:19302` | `stun:stun.l.google.com:19302` |
| `TURN_SERVER_URL` | Relay TURN Server URL | `VITE_TURN_URL` | `TURN_SERVER_URL` | `turn_server_url` |
| `TURN_USERNAME` | TURN Auth Username | `VITE_TURN_USERNAME` | `TURN_USERNAME` | `turn_username` |
| `TURN_CREDENTIAL` | TURN Auth Password/Token | `VITE_TURN_CREDENTIAL` | `TURN_CREDENTIAL` | `turn_credential` |

---

## 3. Web Environment Template (`.env.example`)
```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=luma-1d1cf.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=luma-1d1cf
VITE_FIREBASE_STORAGE_BUCKET=luma-1d1cf.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=908483489382
VITE_FIREBASE_APP_ID=1:908483489382:web:78531bc789e902
VITE_FIREBASE_DATABASE_URL=https://luma-1d1cf-default-rtdb.firebaseio.com
VITE_TURN_URL=turn:standard.relay.metered.ca:443
VITE_TURN_USERNAME=openrelayproject
VITE_TURN_CREDENTIAL=openrelayproject
```

---

## 4. Native iOS Configuration Format (`Luma/Resources/Config.plist`)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>ProjectId</key>
    <string>luma-1d1cf</string>
    <key>DatabaseURL</key>
    <string>https://luma-1d1cf-default-rtdb.firebaseio.com</string>
    <key>StorageBucket</key>
    <string>luma-1d1cf.firebasestorage.app</string>
    <key>StunServers</key>
    <array>
        <string>stun:stun.l.google.com:19302</string>
        <string>stun:stun1.l.google.com:19302</string>
    </array>
</dict>
</plist>
```
