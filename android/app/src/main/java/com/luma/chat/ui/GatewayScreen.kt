package com.luma.chat.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.random.Random

private const val UNLOCK_PASSPHRASE = "gune"
private val SAMPLE_CAPTCHAS = listOf("wvssrq", "bmyqtg", "wxrzvd", "kmyspw", "tvyzqn", "fwnrgd", "qsyvxb", "uvsmrw")

@Composable
fun GatewayScreen(
    onVerified: () -> Unit
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()

    var step by remember { mutableStateOf(1) } // 1: Checkbox, 2: Distorted Captcha
    var isChecking by remember { mutableStateOf(false) }
    var challengeText by remember { mutableStateOf(SAMPLE_CAPTCHAS.random()) }
    var answer by remember { mutableStateOf("") }
    var errorMessage by remember { mutableStateOf("") }

    val handleVerify = {
        if (answer.trim().lowercase() == UNLOCK_PASSPHRASE) {
            onVerified()
        } else {
            errorMessage = "Incorrect captcha. Please try again."
            challengeText = SAMPLE_CAPTCHAS.random()
            answer = ""
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0F0F0F))
    ) {
        // Top Bar: YouTube Mobile Top Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .height(48.dp)
                .background(Color(0xFF0F0F0F))
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(24.dp)
                        .background(Color(0xFFFF0000), RoundedCornerShape(5.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.PlayArrow,
                        contentDescription = "YouTube Play",
                        tint = Color.White,
                        modifier = Modifier.size(16.dp)
                    )
                }
                Text(
                    text = "YouTube",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    letterSpacing = (-0.5).sp
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Icon(Icons.Default.Cast, contentDescription = "Cast", tint = Color.White, modifier = Modifier.size(20.dp))
                Icon(Icons.Default.Notifications, contentDescription = "Alerts", tint = Color.White, modifier = Modifier.size(20.dp))
                Icon(Icons.Default.Search, contentDescription = "Search", tint = Color.White, modifier = Modifier.size(20.dp))

                // Decoy "Open App" Button
                Surface(
                    color = Color(0xFF272727),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.clickable {
                        try {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://m.youtube.com"))
                            context.startActivity(intent)
                        } catch (_: Exception) {}
                    }
                ) {
                    Text(
                        text = "Open App",
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                    )
                }
            }
        }

        // Main Decoy Container
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth(0.92f)
                    .background(Color.White, RoundedCornerShape(4.dp))
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                if (step == 1) {
                    // Step 1: reCAPTCHA v2 Checkbox
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFFF9F9F9), RoundedCornerShape(3.dp))
                            .border(1.dp, Color(0xFFD3D3D3), RoundedCornerShape(3.dp))
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(28.dp)
                                    .border(2.dp, Color(0xFFC1C1C1), RoundedCornerShape(2.dp))
                                    .clickable {
                                        if (!isChecking) {
                                            isChecking = true
                                            coroutineScope.launch {
                                                delay(550)
                                                isChecking = false
                                                step = 2
                                            }
                                        }
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                if (isChecking) {
                                    CircularProgressIndicator(
                                        strokeWidth = 2.dp,
                                        color = Color(0xFF4A90E2),
                                        modifier = Modifier.size(20.dp)
                                    )
                                }
                            }
                            Text(
                                text = "I'm not a robot",
                                fontSize = 14.sp,
                                color = Color(0xFF222222),
                                fontWeight = FontWeight.Normal
                            )
                        }

                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("reCAPTCHA", fontSize = 10.sp, color = Color(0xFF555555), fontWeight = FontWeight.Bold)
                            Text("Privacy - Terms", fontSize = 8.sp, color = Color(0xFF555555))
                        }
                    }
                } else {
                    // Step 2: Distorted Cursive Captcha Challenge
                    Text(
                        text = "Enter the characters you see below",
                        fontSize = 14.sp,
                        color = Color(0xFF333333),
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(bottom = 12.dp)
                    )

                    // Distorted Canvas
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(110.dp)
                            .background(Color(0xFFFCFBFA), RoundedCornerShape(4.dp))
                            .border(1.dp, Color(0xFFE0E0E0), RoundedCornerShape(4.dp))
                    ) {
                        Canvas(modifier = Modifier.fillMaxSize()) {
                            val seed = challengeText.hashCode().toLong()
                            val rng = Random(seed)

                            // Red tangled bezier squiggles
                            for (i in 0 until 24) {
                                val path = Path()
                                val startX = rng.nextFloat() * size.width
                                val startY = rng.nextFloat() * size.height
                                path.moveTo(startX, startY)

                                val cp1x = rng.nextFloat() * size.width
                                val cp1y = rng.nextFloat() * size.height
                                val cp2x = rng.nextFloat() * size.width
                                val cp2y = rng.nextFloat() * size.height
                                val endX = rng.nextFloat() * size.width
                                val endY = rng.nextFloat() * size.height
                                path.cubicTo(cp1x, cp1y, cp2x, cp2y, endX, endY)

                                val squiggleColor = if (i % 2 == 0) Color(0xDADA3A2A) else Color(0x9DEE4E3E)
                                drawPath(path, squiggleColor, style = Stroke(width = 1.5f))
                            }

                            // Letters in dusty slate-blue (#5c8699)
                            val paint = android.graphics.Paint().apply {
                                color = android.graphics.Color.parseColor("#5c8699")
                                textSize = 78f
                                isFakeBoldText = true
                                textSkewX = -0.35f
                                isAntiAlias = true
                            }

                            val chars = challengeText.toCharArray()
                            val spacing = (size.width - 60f) / chars.size
                            chars.forEachIndexed { idx, ch ->
                                val x = 30f + idx * spacing
                                val y = size.height / 2f + 25f + (kotlin.math.sin(idx.toDouble()) * 12).toFloat()
                                drawContext.canvas.nativeCanvas.drawText(ch.toString(), x, y, paint)
                            }
                        }
                    }

                    // Toolbar
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            IconButton(onClick = { challengeText = SAMPLE_CAPTCHAS.random() }) {
                                Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = Color(0xFF666666))
                            }
                            IconButton(onClick = {}) {
                                Icon(Icons.Default.VolumeUp, contentDescription = "Audio", tint = Color(0xFF666666))
                            }
                        }
                    }

                    // Answer Input
                    BasicTextField(
                        value = answer,
                        onValueChange = {
                            answer = it
                            errorMessage = ""
                        },
                        textStyle = TextStyle(color = Color(0xFF222222), fontSize = 16.sp),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { handleVerify() }),
                        cursorBrush = SolidColor(Color(0xFF1976D2)),
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFFF5F5F5), RoundedCornerShape(4.dp))
                            .border(1.dp, Color(0xFFCCCCCC), RoundedCornerShape(4.dp))
                            .padding(12.dp)
                    )

                    if (errorMessage.isNotEmpty()) {
                        Text(
                            text = errorMessage,
                            color = Color(0xFFD32F2F),
                            fontSize = 12.sp,
                            modifier = Modifier.padding(top = 6.dp)
                        )
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    Button(
                        onClick = { handleVerify() },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1A73E8)),
                        shape = RoundedCornerShape(4.dp),
                        modifier = Modifier.fillMaxWidth().height(44.dp)
                    ) {
                        Text("Verify", color = Color.White, fontWeight = FontWeight.Medium, fontSize = 14.sp)
                    }
                }
            }
        }
    }
}
