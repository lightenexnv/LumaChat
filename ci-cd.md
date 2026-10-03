# Luma — Continuous Integration & Deployment (CI/CD) Specifications

## 1. Overview
The CI/CD pipeline ensures that every commit to `main` and all pull requests build cleanly across all target platforms with automated verification and artifact packaging.

---

## 2. GitHub Actions Workflow Matrix

```
       Push / PR to main
              │
   ┌──────────┼──────────┐
   ▼          ▼          ▼
[Web CI]   [iOS CI]   [Android CI]
   │          │          │
 Lint &     Xcode      Gradle
 Vitest    Archive    Assemble
   │          │          │
 Vite      Package     Package
 Build       IPA         APK
   │          │          │
   ▼          ▼          ▼
Artifact:  Artifact:  Artifact:
web-dist   Luma.ipa   Luma.apk
```

---

## 3. Workflow Specifications

### 3.1. Web Pipeline (`.github/workflows/web-build.yml`)
- **Runner**: `ubuntu-latest`
- **Node Version**: `20.x`
- **Steps**:
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` with cache: `npm`
  3. `npm ci`
  4. `npm run lint`
  5. `npm run test` (Vitest)
  6. `npm run build` (TypeScript check & Vite production bundle)
  7. Optional: Automated deployment to Firebase Hosting via `firebase-tools`.

### 3.2. iOS Pipeline (`.github/workflows/build-ipa.yml`)
- **Runner**: `macos-14` (Apple Silicon M1/M2)
- **Xcode Version**: Xcode 15.4 / 16.0
- **Steps**:
  1. `actions/checkout@v4`
  2. Resolve Swift Packages / dependencies.
  3. Run `xcodebuild archive`:
     ```bash
     xcodebuild archive \
       -project ios/Luma.xcodeproj \
       -scheme Luma \
       -configuration Release \
       -sdk iphoneos \
       -archivePath build/Luma.xcarchive \
       CODE_SIGNING_ALLOWED=NO \
       CODE_SIGNING_REQUIRED=NO \
       CODE_SIGN_IDENTITY=""
     ```
  4. Package un-signed IPA:
     ```bash
     mkdir -p Payload
     cp -R build/Luma.xcarchive/Products/Applications/Luma.app Payload/
     zip -r Luma.ipa Payload
     ```
  5. Upload artifact: `actions/upload-artifact@v4` with name `Luma-IPA` and path `Luma.ipa`.

### 3.3. Android Pipeline (`.github/workflows/android-build.yml`)
- **Runner**: `ubuntu-latest`
- **JDK Version**: `17`
- **Steps**:
  1. `actions/checkout@v4`
  2. `actions/setup-java@v4` with distribution `temurin`
  3. Cache Gradle wrapper & dependencies.
  4. Run `./gradlew assembleRelease`
  5. Upload artifact: `actions/upload-artifact@v4` with name `Luma-Android-APK`.

---

## 4. Quality Gates for CI Approval
1. **Zero Warnings-as-Errors**: No unresolved Swift concurrency violations, TypeScript compile errors, or Kotlin linter warnings.
2. **Artifact Size Budget**:
   - Web dist: < 2.5 MB compressed.
   - iOS IPA: < 40 MB uncompressed payload.
   - Android APK: < 35 MB.
3. **Reproducibility**: Builds must be 100% deterministic with locked dependencies (`package-lock.json`, `Package.resolved`, Gradle lockfiles).
