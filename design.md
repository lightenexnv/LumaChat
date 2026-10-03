# Luma — Apple Liquid Glass Design System Specifications

## 1. Design Philosophy
Luma's interface is built on the **Apple Liquid Glass** design philosophy:
- **Depth through Material**: Rather than flat solid colors or opaque cards, surfaces are semi-translucent frosted glass layers that reflect underlying content and background glows.
- **Content-First Hierarchy**: Translucent UI elements recede visually to let conversations and full-screen video feeds dominate.
- **Haptic & Fluid**: Smooth iOS-style spring animations (`interpolatingSpring(stiffness: 300, damping: 25)`), dynamic touch feedback, and tactile button states.
- **Distinct from Generic Clones**: Avoids green WhatsApp header bars or generic flat chat bubbles; adopts iOS FaceTime / Messages aesthetics with floating pills, subtle neon emerald luminescence, and pristine typography.

---

## 2. Design Tokens & Color System

### Dark Mode (Primary Palette)
| Token | Value | Purpose |
| :--- | :--- | :--- |
| `bg-canvas` | `#050505` / `#090909` | Deep OLED true black canvas |
| `glass-surface` | `rgba(255, 255, 255, 0.07)` | Frosted glass cards, input fields, bubbles |
| `glass-surface-elevated`| `rgba(255, 255, 255, 0.12)` | Floating bars, action sheets, active modals |
| `glass-border` | `rgba(255, 255, 255, 0.12)` | 1px hairline glass edge highlight |
| `glass-blur` | `backdrop-filter: blur(24px)` | Depth diffusion effect |
| `primary-accent` | `#30D158` (iOS Emerald) | Primary CTAs, active call indicators, send button |
| `primary-glow` | `rgba(48, 209, 88, 0.25)` | Subtle luminescent halo behind active indicators |
| `text-primary` | `#F5F5F7` (Apple Off-White) | High-contrast body text and headers |
| `text-secondary` | `#8E8E93` (System Gray) | Timestamps, status subtitles, handle labels |
| `destructive` | `#FF453A` (iOS Red) | Decline call, delete message, leave conversation |
| `incoming-call-glow`| `rgba(52, 199, 89, 0.40)` | Pulsing ring during incoming call |

### Light Mode (Secondary Palette)
| Token | Value | Purpose |
| :--- | :--- | :--- |
| `bg-canvas` | `#F2F2F7` | Soft Apple system light background |
| `glass-surface` | `rgba(255, 255, 255, 0.70)` | Frosted white acrylic surfaces |
| `glass-border` | `rgba(0, 0, 0, 0.08)` | Subtle border highlight |
| `glass-blur` | `backdrop-filter: blur(28px)` | Frosted glass diffusion |
| `primary-accent` | `#34C759` | iOS system vibrant green |
| `text-primary` | `#1C1C1E` | High-contrast dark typography |
| `text-secondary` | `#6C6C70` | Secondary typography |

---

## 3. Typography Scale
- **Display / Hero**: `Plus Jakarta Sans` / `SF Pro Display` (Bold, 32px / 40px, -0.02em letter spacing)
- **Title 1 / Headers**: `Plus Jakarta Sans` / `SF Pro Text` (Semibold, 22px / 28px)
- **Title 2 / Section Labels**: `SF Pro Text` (Semibold, 17px)
- **Body Regular**: `Inter` / `SF Pro Text` (Regular, 15px, line-height 20px)
- **Captions & Timestamps**: `Inter` / `SF Pro Text` (Medium, 12px, line-height 16px)
- **Monospace Code**: `SF Mono` / `JetBrains Mono` (Regular, 13px)

---

## 4. Key Component Specifications

### 4.1. Floating Glass Navigation Bar (Pill Bar)
- **Container**: Floating pill elevated 16px above bottom safe area.
- **Dimensions**: Height 64px, pill border radius `9999px`.
- **Material**: `rgba(18, 18, 20, 0.75)` with `backdrop-filter: blur(24px)` and 1px border `rgba(255, 255, 255, 0.12)`.
- **Items**: 3 tabs (Chats, Calls, You / Settings) with active tab highlighted with emerald icon and subtle green glow dot.

### 4.2. Chat Detail Screen & Message Bubbles
- **Header**: Compact floating glass bar showing contact avatar, display name, handle, online/presence dot, and quick voice/video call buttons.
- **Outgoing Message Bubble**:
  - Background: Gradient from `#25B84C` to `#1EA742` with 1px inner highlight.
  - Text: Pure white `#FFFFFF`, font size 15px.
  - Border radius: `18px 18px 4px 18px` (rounded with bottom-right corner anchor).
  - Status Indicator: Small dual checks icon aligned to the bottom right with timestamp.
- **Incoming Message Bubble**:
  - Background: `rgba(255, 255, 255, 0.08)` with `backdrop-filter: blur(16px)` and 1px border `rgba(255, 255, 255, 0.10)`.
  - Text: Off-white `#F5F5F7`.
  - Border radius: `18px 18px 18px 4px`.
- **Media Cards**:
  - Embedded image/video previews with rounded 14px corners and subtle dark gradient scrim for timestamp readability.

### 4.3. Full-Screen FaceTime Calling Overlay
- **Background**:
  - In Video Call: Full-bleed remote video stream filling viewport (`aspectRatio(.fill)`).
  - In Voice Call: Deep dark OLED background `#050505` with high-resolution contact avatar centered, surrounded by pulsing audio reactive glow rings.
- **Picture-in-Picture (PIP) Local Video**:
  - Rounded rectangular floating card (100px x 140px, corner radius 20px, 1.5px glass border).
  - Draggable to any of the 4 screen corners with spring snapping.
- **Floating Call Control Dock**:
  - Floating pill docked 32px above screen bottom.
  - Translucent frosted container (`rgba(0, 0, 0, 0.65)`, blur 30px).
  - Controls:
    1. **Mute Microphone**: Circular glass button (active = white with red slash).
    2. **Toggle Camera**: Circular glass button.
    3. **Flip Camera**: Front/Back toggle with 360° flip animation.
    4. **Volume Booster**: Audio gain slider (100% to 200%).
    5. **End Call**: Vivid red circular button (`#FF453A`) with phone-hangup icon.
- **Status Indicator**:
  - Top floating pill showing Call Duration (`04:28`) and Network Quality badge (`HD 1080p` green / `360p` yellow / `Audio Only` orange).

### 4.4. Voice Note Composer
- **Resting State**: Microphone icon next to text input.
- **Active Hold / Lock State**:
  - Recording timer (`0:05`), real-time audio waveform animation bars reacting to microphone input.
  - Swipe up to lock recording mode.
  - Swipe left to slide-and-cancel with trash can animation.
  - Send button dispatches encrypted audio note immediately.
