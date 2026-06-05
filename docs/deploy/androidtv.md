# Deploying to Android TV

Unlike Tizen and webOS, Android TV has no native "web app" packaging format. Your SolidTV app runs in a **WebView** that you embed inside a small native Android container. This guide covers the container options and what to load into it.

## Choosing a Container

There are four common ways to get a SolidTV app onto Android TV. They differ mostly in how much native code and tooling you take on.

### 1. Native WebView container (recommended)

A minimal Kotlin/Java Android app whose only job is to host one full-screen `WebView`. You control hardware acceleration, key mapping, and the WebView settings directly, which matters because SolidTV renders over WebGL/Canvas and is driven by D-pad input.

**Pros:** Smallest footprint, full control over WebView flags and key handling, no extra runtime. **Cons:** You write (a little) Kotlin and own the Gradle build.

This is the recommended approach for most teams — see the full setup below.

### 2. Capacitor

[Capacitor](https://capacitorjs.com/) wraps your web build in a native shell and gives you a plugin ecosystem (storage, network, device info) plus a clean CLI. It still uses the system WebView under the hood, so WebGL performance is identical to option 1.

**Pros:** Good tooling, plugins, handles the native project scaffolding for you. **Cons:** Extra dependency; Android TV is not a first-class Capacitor target, so you'll still hand-edit the manifest for `LEANBACK_LAUNCHER` and D-pad handling.

Recommended if you already use Capacitor elsewhere or want its plugin APIs.

### 3. Cordova

[Apache Cordova](https://cordova.apache.org/) is the older predecessor to Capacitor. It works, but tooling is dated and the plugin ecosystem is in decline. Only choose this if you have an existing Cordova investment.

### 4. Trusted Web Activity (TWA) — not recommended for TV

TWA launches your PWA through Chrome. On Android TV, Chrome is not guaranteed to be installed, D-pad handling is inconsistent, and you give up control over WebView flags. **Avoid TWA for TV.**

> **Recommendation:** Use a native WebView container (option 1) for the most control, or Capacitor (option 2) if you want managed tooling and plugins. Both rely on the system WebView, so rendering performance is the same — the difference is how much scaffolding you maintain.

## Why the System WebView Matters

SolidTV renders through WebGL/Canvas, so performance is bound by the **Android System WebView** version on the device, not your container. Older or low-end Android TV boxes may ship an outdated WebView that lacks good WebGL performance or modern JS features.

- Always test on real target hardware, not just the emulator.
- Ensure **hardware acceleration** is enabled (it is by default at the application level, but confirm it isn't disabled).
- On devices where the WebView is badly outdated, consider bundling [GeckoView](https://mozilla.github.io/geckoview/) as the rendering engine instead of the system WebView for a consistent runtime — at the cost of a much larger APK.

## Native WebView Container Setup

### Project Layout

Create an `androidtv/` folder in your SolidTV project to hold the native shell, alongside your web app. Use Android Studio to scaffold an **Empty Activity** project, or set up Gradle manually.

### AndroidManifest.xml

The manifest is what makes the app appear in the Android TV launcher (Leanback) and declares it as a TV app.

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.soliddemo">

    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />
    <uses-feature android:name="android.software.leanback" android:required="true" />
    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:label="SolidTV Demo App"
        android:icon="@mipmap/ic_launcher"
        android:banner="@drawable/banner"
        android:hardwareAccelerated="true"
        android:theme="@style/Theme.AppCompat.NoActionBar">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="keyboard|keyboardHidden|orientation|screenSize"
            android:screenOrientation="landscape">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <!-- LEANBACK_LAUNCHER makes the app show on the Android TV home screen -->
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

Two TV-specific requirements: the `android.software.leanback` feature and the `LEANBACK_LAUNCHER` category. You must also supply a `banner` drawable (320×180) or the app won't appear on the home screen.

### MainActivity.kt

A single full-screen, immersive WebView with the settings SolidTV needs.

```kotlin
package com.example.soliddemo

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // Keep WebView at native resolution; SolidTV handles its own scaling
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        // Keep navigation inside the WebView
        webView.webViewClient = WebViewClient()

        // Immersive full-screen — hide system bars
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )

        // Hosted app: point at your public URL.
        webView.loadUrl("https://example.com")
        // Bundled app: load from assets instead (see below).
        // webView.loadUrl("file:///android_asset/index.html")
    }

    // Let the back button navigate WebView history before exiting
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
```

#### A note on key handling

The Android D-pad already dispatches standard `keydown` events (arrow keys, Enter) to the WebView, which is exactly what SolidTV's focus manager expects — so in most cases **no native key mapping is needed**. If your target device sends non-standard key codes, override `dispatchKeyEvent` in the activity and inject the corresponding key into the WebView via `evaluateJavascript`.

### Hosted vs. Bundled

Just like the Tizen and webOS guides, you have two delivery models:

- **Hosted app (recommended for fast iteration):** Host your built app at a public URL and point `loadUrl` at it. Updates ship instantly with no APK release. Make sure the device has reliable network.
- **Bundled app:** Build your app into the APK's `assets/` folder and load `file:///android_asset/index.html`. Works offline and is fully self-contained, but every update requires a new APK.

For a bundled build, output your Vite build into the Android assets folder with a relative base path:

```json
"build:androidtv": "vite build --sourcemap=false --base=./ --outDir androidtv/app/src/main/assets --emptyOutDir false"
```

## Building and Installing

Build the APK with Gradle and install it over `adb`:

```sh
# From the androidtv/ folder
./gradlew assembleDebug

# Enable Developer Options + USB/Network debugging on the device, then:
adb connect <tv-ip>:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The app will appear in the **Apps** row on the Android TV home screen via the Leanback launcher.

## Debugging

Chrome's remote debugger works against the device WebView:

1. Connect to the device with `adb connect <tv-ip>:5555`.
2. Open `chrome://inspect/#devices` in desktop Chrome.
3. Your WebView appears under the device — click **inspect** to open full DevTools.

This gives you the console, network panel, and a WebGL-capable inspector against the live app on the TV.

## Support Links

- **Android TV — Build TV Apps**: [https://developer.android.com/training/tv/start](https://developer.android.com/training/tv/start)
- **WebView documentation**: [https://developer.android.com/develop/ui/views/layout/webapps/webview](https://developer.android.com/develop/ui/views/layout/webapps/webview)
- **Capacitor**: [https://capacitorjs.com/docs/android](https://capacitorjs.com/docs/android)
- **GeckoView**: [https://mozilla.github.io/geckoview/](https://mozilla.github.io/geckoview/)
- **Remote debugging WebViews**: [https://developer.chrome.com/docs/devtools/remote-debugging/](https://developer.chrome.com/docs/devtools/remote-debugging/)
