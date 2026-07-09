# App Store / Google Play Handoff

This folder contains a Capacitor-ready web bundle:

- `www/`: production game build
- `capacitor.config.json`: native wrapper config

To produce real App Store / Google Play uploads, use your Apple Developer / Google Play accounts and signing certificates:

```powershell
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android
npx cap sync
```

Then build and sign in Xcode for App Store, and Android Studio/Gradle for Google Play. Store uploads cannot be generated truthfully without those account-specific signing assets.

## iOS build

The repository root includes a Codemagic workflow named:

```text
Build iOS IPA
```

Before running it, set up Apple signing in Codemagic for this bundle id:

```text
com.zeyadmamdouh.frontline
```

The required hosted API variable is:

```text
FRONTLINE_API_BASE_URL=https://frontline-game-host--zeyad0565615778.replit.app/api
```

iOS apps cannot be installed like APK files. Use TestFlight or the App Store for real iPhone/iPad installation.
