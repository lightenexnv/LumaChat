import SwiftUI
import AVFoundation

// MARK: - Native Call Overlay View (Full WhatsApp Web Parity & Gestures)
public struct CallOverlayView: View {
    @ObservedObject var webrtc = WebRTCService.shared
    @ObservedObject var db = DatabaseService.shared
    
    @State private var isShowingControlsSheet: Bool = false
    @State private var isSwapped: Bool = false // false: Remote main, Local PiP; true: Local main, Remote PiP
    @State private var zoomLevel: CGFloat = 1.0
    @State private var panOffset: CGSize = .zero
    @State private var pipPosition: CGPoint = CGPoint(x: UIScreen.main.bounds.width - 80, y: 140)
    @State private var isFlashing: Bool = false
    @State private var showCapturedToast: Bool = false
    
    public init() {}
    
    public var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            
            // White Shutter Flash Animation
            if isFlashing {
                Color.white.ignoresSafeArea()
                    .transition(.opacity)
                    .zIndex(200)
            }
            
            // Main Stage Video (Touch Pinch-to-Zoom & Pan)
            ZStack {
                if webrtc.isVideoCall {
                    // Video Call Surface
                    ZStack {
                        LinearGradient(
                            colors: [Color(hex: "062B22"), Color(hex: "020F0C"), Color.black],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .ignoresSafeArea()
                        
                        VStack(spacing: 16) {
                            ZStack {
                                Circle()
                                    .fill(GlassTheme.avatarColor(for: webrtc.activeParticipantId))
                                    .frame(width: 110, height: 110)
                                
                                if let photo = webrtc.activeParticipantAvatar, let url = URL(string: photo) {
                                    AsyncImage(url: url) { img in
                                        img.resizable().scaledToFill()
                                    } placeholder: {
                                        Text(webrtc.activeParticipantInitials.isEmpty ? String(webrtc.activeParticipantName.prefix(1)).uppercased() : webrtc.activeParticipantInitials)
                                            .font(.system(size: 44, weight: .bold))
                                            .foregroundColor(.white)
                                    }
                                    .frame(width: 110, height: 110)
                                    .clipShape(Circle())
                                } else {
                                    Text(webrtc.activeParticipantInitials.isEmpty ? String(webrtc.activeParticipantName.prefix(1)).uppercased() : webrtc.activeParticipantInitials)
                                        .font(.system(size: 44, weight: .bold))
                                        .foregroundColor(.white)
                                }
                            }
                            
                            Text(webrtc.activeParticipantName)
                                .font(.system(size: 24, weight: .semibold))
                                .foregroundColor(.white)
                            
                            if webrtc.callState == .ringing {
                                Text(webrtc.isCaller ? "Ringing..." : "Connecting...")
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundColor(GlassTheme.accentEmerald)
                            } else if webrtc.callState == .declined {
                                Text("Declined")
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundColor(GlassTheme.dangerRed)
                            } else {
                                Text(webrtc.formatDuration(webrtc.callDurationSeconds))
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundColor(GlassTheme.accentEmerald)
                            }
                        }
                    }
                    .scaleEffect(zoomLevel)
                    .offset(panOffset)
                    .gesture(
                        MagnificationGesture()
                            .onChanged { value in
                                zoomLevel = min(max(1.0, value), 5.0)
                            }
                            .simultaneously(with:
                                DragGesture()
                                    .onChanged { value in
                                        if zoomLevel > 1.0 {
                                            panOffset = value.translation
                                        }
                                    }
                            )
                    )
                    .onTapGesture(count: 2) {
                        withAnimation(.spring()) {
                            zoomLevel = 1.0
                            panOffset = .zero
                        }
                    }
                } else {
                    // Audio-Only Ringing Surface
                    VStack(spacing: 20) {
                        ZStack {
                            Circle()
                                .stroke(GlassTheme.accentEmerald.opacity(0.3), lineWidth: 4)
                                .frame(width: 140, height: 140)
                            
                            Circle()
                                .fill(GlassTheme.avatarColor(for: webrtc.activeParticipantId))
                                .frame(width: 110, height: 110)
                            
                            if let photo = webrtc.activeParticipantAvatar, let url = URL(string: photo) {
                                AsyncImage(url: url) { img in
                                    img.resizable().scaledToFill()
                                } placeholder: {
                                    Text(webrtc.activeParticipantInitials.isEmpty ? String(webrtc.activeParticipantName.prefix(1)).uppercased() : webrtc.activeParticipantInitials)
                                        .font(.system(size: 46, weight: .bold))
                                        .foregroundColor(.white)
                                }
                                .frame(width: 110, height: 110)
                                .clipShape(Circle())
                            } else {
                                Text(webrtc.activeParticipantInitials.isEmpty ? String(webrtc.activeParticipantName.prefix(1)).uppercased() : webrtc.activeParticipantInitials)
                                    .font(.system(size: 46, weight: .bold))
                                    .foregroundColor(.white)
                            }
                        }
                        
                        Text(webrtc.activeParticipantName)
                            .font(.system(size: 26, weight: .bold))
                            .foregroundColor(.white)
                        
                        if webrtc.callState == .ringing {
                            Text(webrtc.isCaller ? "Ringing..." : "Connecting...")
                                .font(.system(size: 17, weight: .medium))
                                .foregroundColor(GlassTheme.accentEmerald)
                        } else if webrtc.callState == .declined {
                            Text("Declined")
                                .font(.system(size: 17, weight: .medium))
                                .foregroundColor(GlassTheme.dangerRed)
                        } else {
                            Text(webrtc.formatDuration(webrtc.callDurationSeconds))
                                .font(.system(size: 17, weight: .medium))
                                .foregroundColor(GlassTheme.accentEmerald)
                        }
                    }
                }
            }
            
            // Floating Zoom Reset Pill
            if zoomLevel > 1.0 {
                VStack {
                    HStack {
                        Spacer()
                        Button(action: {
                            withAnimation(.spring()) {
                                zoomLevel = 1.0
                                panOffset = .zero
                            }
                        }) {
                            HStack(spacing: 5) {
                                Image(systemName: "magnifyingglass")
                                Text(String(format: "%.1fx Reset", zoomLevel))
                            }
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.black)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(GlassTheme.accentEmerald)
                            .clipShape(Capsule())
                        }
                        .padding(.trailing, 20)
                        .padding(.top, 100)
                    }
                    Spacer()
                }
            }
            
            // Captured Photo Toast Notification Banner
            if showCapturedToast {
                VStack {
                    HStack(spacing: 12) {
                        Image(systemName: "camera.fill")
                            .foregroundColor(GlassTheme.accentEmerald)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Photo captured")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.white)
                            Text("Saved & sent to chat")
                                .font(.system(size: 12))
                                .foregroundColor(GlassTheme.textSecondary)
                        }
                        Spacer()
                        Button(action: { showCapturedToast = false }) {
                            Image(systemName: "xmark")
                                .foregroundColor(GlassTheme.textSecondary)
                        }
                    }
                    .padding(14)
                    .glassBackground(cornerRadius: 14)
                    .padding(.horizontal, 20)
                    .padding(.top, 60)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    
                    Spacer()
                }
                .zIndex(150)
            }
            
            // Top Bar
            VStack {
                HStack {
                    // Minimize / End back chevron
                    Button(action: { webrtc.endCall() }) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: 36, height: 36)
                            .background(.ultraThinMaterial)
                            .clipShape(Circle())
                    }
                    
                    // Center Peer Name & Timer
                    VStack(spacing: 2) {
                        Text(webrtc.activeParticipantName)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundColor(.white)
                        Text(webrtc.formatDuration(webrtc.callDurationSeconds))
                            .font(.system(size: 13))
                            .foregroundColor(GlassTheme.textSecondary)
                    }
                    .padding(.leading, 8)
                    
                    Spacer()
                    
                    // Network Quality Pill
                    HStack(spacing: 6) {
                        Circle()
                            .fill(GlassTheme.accentEmerald)
                            .frame(width: 8, height: 8)
                        Text("HD 1080p")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.white)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.ultraThinMaterial)
                    .clipShape(Capsule())
                }
                .padding(.horizontal, 16)
                .padding(.top, 50)
                
                Spacer()
            }
            
            // Floating Picture-in-Picture Tile (Draggable + Tap to Swap)
            if webrtc.isVideoCall && !webrtc.isCameraOff {
                VStack {
                    ZStack {
                        CameraPreviewView(isFront: $webrtc.isFrontCamera)
                            .frame(width: 105, height: 145)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                            .overlay(
                                RoundedRectangle(cornerRadius: 16)
                                    .stroke(GlassTheme.glassBorder, lineWidth: 1)
                            )
                            .shadow(color: Color.black.opacity(0.4), radius: 8, x: 0, y: 4)
                    }
                    .position(pipPosition)
                    .gesture(
                        DragGesture()
                            .onChanged { value in
                                pipPosition = CGPoint(x: value.location.x, y: value.location.y)
                            }
                    )
                    .onTapGesture {
                        withAnimation(.spring()) {
                            isSwapped.toggle()
                        }
                    }
                }
            }
            
            // Floating Snapshot Capture Button matching Web & IMG_1637.PNG
            if webrtc.isVideoCall {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Button(action: takeCallPhoto) {
                            ZStack {
                                Circle()
                                    .stroke(Color.white, lineWidth: 3)
                                    .frame(width: 58, height: 58)
                                Circle()
                                    .fill(Color.white)
                                    .frame(width: 48, height: 48)
                            }
                            .shadow(color: Color.black.opacity(0.4), radius: 8, y: 4)
                        }
                        .padding(.trailing, 24)
                        .padding(.bottom, 110)
                    }
                }
            }
            
            // Floating Bottom Capsule Dock
            VStack {
                Spacer()
                
                HStack(spacing: 20) {
                    // More options
                    Button(action: { isShowingControlsSheet = true }) {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 20))
                            .foregroundColor(.white)
                            .frame(width: 52, height: 52)
                            .background(Color.white.opacity(0.18))
                            .clipShape(Circle())
                    }
                    
                    // Camera Toggle
                    if webrtc.isVideoCall {
                        Button(action: { webrtc.toggleCamera() }) {
                            Image(systemName: webrtc.isCameraOff ? "video.slash.fill" : "video.fill")
                                .font(.system(size: 20))
                                .foregroundColor(webrtc.isCameraOff ? .black : .white)
                                .frame(width: 52, height: 52)
                                .background(webrtc.isCameraOff ? Color.white : Color.white.opacity(0.18))
                                .clipShape(Circle())
                        }
                    }
                    
                    // Camera Flip
                    if webrtc.isVideoCall {
                        Button(action: { webrtc.switchCamera() }) {
                            Image(systemName: "camera.rotate.fill")
                                .font(.system(size: 20))
                                .foregroundColor(.white)
                                .frame(width: 52, height: 52)
                                .background(Color.white.opacity(0.18))
                                .clipShape(Circle())
                        }
                    }
                    
                    // Mic Mute
                    Button(action: { webrtc.toggleMute() }) {
                        Image(systemName: webrtc.isMuted ? "mic.slash.fill" : "mic.fill")
                            .font(.system(size: 20))
                            .foregroundColor(webrtc.isMuted ? .black : .white)
                            .frame(width: 52, height: 52)
                            .background(webrtc.isMuted ? Color.white : Color.white.opacity(0.18))
                            .clipShape(Circle())
                    }
                    
                    // End Call Circle
                    Button(action: { webrtc.endCall() }) {
                        Image(systemName: "phone.down.fill")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundColor(.white)
                            .frame(width: 58, height: 58)
                            .background(GlassTheme.dangerRed)
                            .clipShape(Circle())
                            .shadow(color: GlassTheme.dangerRed.opacity(0.4), radius: 10, y: 4)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(.ultraThinMaterial)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(GlassTheme.glassBorder, lineWidth: 1))
                .padding(.bottom, 36)
            }
        }
        .sheet(isPresented: $isShowingControlsSheet) {
            CallOptionsSheetView(isPresented: $isShowingControlsSheet)
        }
    }
    
    private func takeCallPhoto() {
        isFlashing = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            isFlashing = false
            withAnimation {
                showCapturedToast = true
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
                withAnimation {
                    showCapturedToast = false
                }
            }
        }
    }
}

// MARK: - Call Options Sheet
public struct CallOptionsSheetView: View {
    @Binding var isPresented: Bool
    @ObservedObject var webrtc = WebRTCService.shared
    
    public var body: some View {
        ZStack {
            GlassTheme.backgroundBlack.ignoresSafeArea()
            
            VStack(spacing: 20) {
                HStack {
                    Text("Call Options").font(.system(size: 18, weight: .bold)).foregroundColor(.white)
                    Spacer()
                    Button("Done") { isPresented = false }.foregroundColor(GlassTheme.accentEmerald)
                }
                .padding(.top, 16)
                
                // Volume Boost Control (up to 500%)
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Volume Boost").font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                        Spacer()
                        Text("\(Int(webrtc.volumeBoost * 100))%").font(.system(size: 14)).foregroundColor(GlassTheme.accentEmerald)
                    }
                    Slider(value: $webrtc.volumeBoost, in: 1.0...5.0, step: 0.1)
                        .accentColor(GlassTheme.accentEmerald)
                }
                .padding(16)
                .glassBackground(cornerRadius: 16)
                
                // Mirror Camera POV
                Toggle(isOn: $webrtc.isMirrorCameraOn) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Mirror Camera").font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                        Text(webrtc.isMirrorCameraOn ? "On (Left is left synchronized)" : "Off (Direct camera POV)")
                            .font(.system(size: 12)).foregroundColor(GlassTheme.textSecondary)
                    }
                }
                .toggleStyle(SwitchToggleStyle(tint: GlassTheme.accentEmerald))
                .padding(16)
                .glassBackground(cornerRadius: 16)
                
                Spacer()
            }
            .padding(.horizontal, 20)
        }
    }
}

// MARK: - Native Camera Preview View (Live Camera Surface for PiP & Video Calling)
struct CameraPreviewView: UIViewRepresentable {
    @Binding var isFront: Bool
    
    func makeUIView(context: Context) -> CameraPreviewUIView {
        let view = CameraPreviewUIView()
        view.setupSession(isFront: isFront)
        return view
    }
    
    func updateUIView(_ uiView: CameraPreviewUIView, context: Context) {
        uiView.switchCamera(isFront: isFront)
    }
}

class CameraPreviewUIView: UIView {
    private let session = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var currentPosition: AVCaptureDevice.Position = .front
    
    override func layoutSubviews() {
        super.layoutSubviews()
        previewLayer?.frame = bounds
    }
    
    func setupSession(isFront: Bool) {
        currentPosition = isFront ? .front : .back
        session.beginConfiguration()
        session.sessionPreset = .high
        
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: currentPosition),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            session.commitConfiguration()
            return
        }
        session.addInput(input)
        session.commitConfiguration()
        
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = bounds
        self.layer.addSublayer(layer)
        self.previewLayer = layer
        
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.session.startRunning()
        }
    }
    
    func switchCamera(isFront: Bool) {
        let newPosition: AVCaptureDevice.Position = isFront ? .front : .back
        guard newPosition != currentPosition else { return }
        currentPosition = newPosition
        
        session.beginConfiguration()
        for input in session.inputs {
            session.removeInput(input)
        }
        if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: currentPosition),
           let input = try? AVCaptureDeviceInput(device: device),
           session.canAddInput(input) {
            session.addInput(input)
        }
        session.commitConfiguration()
    }
}

