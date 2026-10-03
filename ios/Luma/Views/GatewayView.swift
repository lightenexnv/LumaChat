import SwiftUI
import AVFoundation

public struct GatewayView: View {
    public let onVerified: () -> Void
    
    @State private var step: Int = 1 // 1: Checkbox, 2: Distorted Captcha
    @State private var isChecking: Bool = false
    @State private var challengeText: String = "wvssrq"
    @State private var answer: String = ""
    @State private var errorMessage: String = ""
    
    private let sampleCaptchas = ["wvssrq", "bmyqtg", "wxrzvd", "kmyspw", "tvyzqn", "fwnrgd", "qsyvxb", "uvsmrw"]
    private let synthesizer = AVSpeechSynthesizer()
    
    public init(onVerified: @escaping () -> Void) {
        self.onVerified = onVerified
    }
    
    public var body: some View {
        ZStack {
            Color(red: 15/255, green: 15/255, blue: 15/255)
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                // MARK: - Decoy YouTube Mobile Top Bar
                HStack(spacing: 12) {
                    HStack(spacing: 4) {
                        Image(systemName: "play.rectangle.fill")
                            .font(.system(size: 22))
                            .foregroundColor(.red)
                        Text("YouTube")
                            .font(.system(size: 19, weight: .bold))
                            .foregroundColor(.white)
                            .tracking(-0.5)
                    }
                    
                    Spacer()
                    
                    HStack(spacing: 18) {
                        Image(systemName: "tv.badge.wifi")
                            .font(.system(size: 18))
                            .foregroundColor(.white)
                        Image(systemName: "bell")
                            .font(.system(size: 18))
                            .foregroundColor(.white)
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 18))
                            .foregroundColor(.white)
                        
                        // Decoy "Open App" Button
                        Button(action: {
                            if let url = URL(string: "https://m.youtube.com") {
                                UIApplication.shared.open(url)
                            }
                        }) {
                            Text("Open App")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.white)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Color(white: 0.2))
                                .clipShape(Capsule())
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color(red: 15/255, green: 15/255, blue: 15/255))
                
                Spacer()
                
                // MARK: - Captcha Decoy Card
                VStack(spacing: 16) {
                    if step == 1 {
                        // Step 1: reCAPTCHA v2 Checkbox
                        HStack(spacing: 14) {
                            Button(action: {
                                guard !isChecking else { return }
                                isChecking = true
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.55) {
                                    isChecking = false
                                    challengeText = sampleCaptchas.randomElement() ?? "wvssrq"
                                    step = 2
                                }
                            }) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 3)
                                        .stroke(Color(white: 0.75), lineWidth: 2)
                                        .frame(width: 28, height: 28)
                                    
                                    if isChecking {
                                        ProgressView()
                                            .progressViewStyle(CircularProgressViewStyle(tint: .blue))
                                            .scaleEffect(0.8)
                                    }
                                }
                            }
                            
                            Text("I'm not a robot")
                                .font(.system(size: 15))
                                .foregroundColor(Color(white: 0.15))
                            
                            Spacer()
                            
                            VStack(spacing: 2) {
                                Image(systemName: "arrow.triangle.2.circlepath")
                                    .font(.system(size: 18))
                                    .foregroundColor(.blue)
                                Text("reCAPTCHA")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(.gray)
                                Text("Privacy - Terms")
                                    .font(.system(size: 8))
                                    .foregroundColor(.gray)
                            }
                        }
                        .padding(16)
                        .background(Color(red: 249/255, green: 249/255, blue: 249/255))
                        .cornerRadius(4)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4)
                                .stroke(Color(white: 0.82), lineWidth: 1)
                        )
                    } else {
                        // Step 2: Distorted Cursive Graffiti Canvas
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Enter the characters you see below")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(Color(white: 0.2))
                            
                            // Custom Distorted Captcha Drawing View
                            CaptchaDrawingView(text: challengeText)
                                .frame(height: 110)
                                .background(Color(red: 252/255, green: 251/255, blue: 250/255))
                                .cornerRadius(4)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 4)
                                        .stroke(Color(white: 0.85), lineWidth: 1)
                                )
                            
                            HStack {
                                Button(action: {
                                    challengeText = sampleCaptchas.randomElement() ?? "wvssrq"
                                }) {
                                    Image(systemName: "arrow.clockwise")
                                        .font(.system(size: 16))
                                        .foregroundColor(Color(white: 0.4))
                                }
                                
                                Button(action: {
                                    let utterance = AVSpeechUtterance(string: challengeText.map { String($0) }.joined(separator: " "))
                                    utterance.rate = 0.3
                                    synthesizer.speak(utterance)
                                }) {
                                    Image(systemName: "speaker.wave.2")
                                        .font(.system(size: 16))
                                        .foregroundColor(Color(white: 0.4))
                                }
                                
                                Spacer()
                            }
                            
                            TextField("", text: $answer)
                                .font(.system(size: 16))
                                .foregroundColor(.black)
                                .padding(10)
                                .background(Color(red: 245/255, green: 245/255, blue: 245/255))
                                .cornerRadius(4)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 4)
                                        .stroke(Color(white: 0.78), lineWidth: 1)
                                )
                                .autocapitalization(.none)
                                .disableAutocorrection(true)
                            
                            if !errorMessage.isEmpty {
                                Text(errorMessage)
                                    .font(.system(size: 12))
                                    .foregroundColor(.red)
                            }
                            
                            Button(action: {
                                if answer.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "gune" {
                                    UserDefaults.standard.set(true, forKey: "luma:verified-session")
                                    onVerified()
                                } else {
                                    errorMessage = "Incorrect captcha. Please try again."
                                    challengeText = sampleCaptchas.randomElement() ?? "wvssrq"
                                    answer = ""
                                }
                            }) {
                                Text("Verify")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(.white)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .background(Color(red: 26/255, green: 115/255, blue: 232/255))
                                    .cornerRadius(4)
                            }
                        }
                        .padding(16)
                    }
                }
                .background(Color.white)
                .cornerRadius(6)
                .shadow(color: Color.black.opacity(0.3), radius: 10, x: 0, y: 5)
                .padding(.horizontal, 24)
                
                Spacer()
            }
        }
    }
}

// MARK: - Distorted Captcha Drawing Canvas
private struct CaptchaDrawingView: View {
    let text: String
    
    var body: some View {
        GeometryReader { geo in
            ZStack {
                // Tangled red squiggles
                Canvas { context, size in
                    for i in 0..<24 {
                        var path = Path()
                        let start = CGPoint(
                            x: CGFloat((sin(Double(i * 13)) + 1) / 2) * size.width,
                            y: CGFloat((cos(Double(i * 17)) + 1) / 2) * size.height
                        )
                        path.move(to: start)
                        
                        let cp1 = CGPoint(
                            x: CGFloat((cos(Double(i * 7)) + 1) / 2) * size.width,
                            y: CGFloat((sin(Double(i * 23)) + 1) / 2) * size.height
                        )
                        let cp2 = CGPoint(
                            x: CGFloat((sin(Double(i * 31)) + 1) / 2) * size.width,
                            y: CGFloat((cos(Double(i * 11)) + 1) / 2) * size.height
                        )
                        let end = CGPoint(
                            x: CGFloat((cos(Double(i * 19)) + 1) / 2) * size.width,
                            y: CGFloat((sin(Double(i * 5)) + 1) / 2) * size.height
                        )
                        path.addCurve(to: end, control1: cp1, control2: cp2)
                        
                        let strokeColor = i % 2 == 0
                            ? Color(red: 218/255, green: 58/255, blue: 42/255, opacity: 0.75)
                            : Color(red: 238/255, green: 78/255, blue: 62/255, opacity: 0.6)
                        context.stroke(path, with: .color(strokeColor), lineWidth: 1.5)
                    }
                }
                
                // Slate-blue (#5c8699) cursive distorted letters
                HStack(spacing: 8) {
                    ForEach(Array(text.enumerated()), id: \.offset) { idx, char in
                        Text(String(char))
                            .font(.system(size: 38, weight: .bold, design: .serif))
                            .italic()
                            .foregroundColor(Color(red: 92/255, green: 134/255, blue: 153/255))
                            .rotationEffect(.degrees(sin(Double(idx * 2)) * 14))
                            .offset(y: sin(Double(idx * 3)) * 8)
                    }
                }
            }
        }
    }
}
