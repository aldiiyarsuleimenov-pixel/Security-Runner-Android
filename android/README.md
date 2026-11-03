# Security Runner Android wrapper

This Android app hosts the Vite-built game locally inside Android WebView. It does not need Replit or a hosted website at runtime. Internet permission is retained for the VCR OSD Mono / font stylesheet currently loaded from its CDN.

## Build from GitHub Actions

1. Upload the complete project repository to GitHub.
2. Open the repository's **Actions** tab.
3. Select **Build Security Runner APK**.
4. Tap **Run workflow** (or push to `main` to trigger a build automatically).
5. Open the successful workflow run, scroll to **Artifacts**, and download `Security-Runner-APK`.
6. Extract the artifact ZIP and install `app-debug.apk` on Android.

The APK is currently a debug build for personal testing, not a Play Store release-signed APK.
