# iOS Build Setup

The iOS version is built from the same Capacitor mobile package as Android:

```text
release/frontline-uae-war-city-mobile
```

## What is already prepared

- Capacitor iOS dependency is added.
- Codemagic has a `Build iOS IPA` workflow.
- The iOS app uses the same bundle id as the Android package style:

```text
com.zeyadmamdouh.frontline
```

- The workflow writes the hosted API URL into the app before building.
- The workflow locks the iOS app to landscape.
- The workflow generates iPhone/iPad app icons from:

```text
release/frontline-uae-war-city-mobile/app-icon/frontline-logo-source.png
```

## Required before the first iOS build

iOS apps cannot be installed like Android APK files. A real `.ipa` for iPhone must be signed by Apple.

You need:

1. Apple Developer Program account.
2. App Store Connect app record.
3. Bundle ID:

```text
com.zeyadmamdouh.frontline
```

4. Codemagic iOS signing set up for `app_store` distribution.
5. Codemagic environment variable group `production` must include:

```text
FRONTLINE_API_BASE_URL=https://frontline-game-host--zeyad0565615778.replit.app/api
```

Optional, only if your WebSocket URL is different:

```text
FRONTLINE_WS_BASE_URL=wss://frontline-game-host--zeyad0565615778.replit.app/api/ws
```

## Codemagic signing steps

In Codemagic:

1. Open Team settings.
2. Open Developer Portal integration.
3. Add an App Store Connect API key, or upload signing files manually.
4. Open `codemagic.yaml settings > Code signing identities`.
5. Add an Apple Distribution certificate.
6. Add an App Store provisioning profile for:

```text
com.zeyadmamdouh.frontline
```

7. Go back to the app.
8. Start workflow:

```text
Build iOS IPA
```

The output artifact will be an `.ipa` file.

## Testing on iPhone

Best path:

1. Upload the `.ipa` to App Store Connect.
2. Use TestFlight.
3. Install from TestFlight on iPhone/iPad.

Do not use the Replit download website for iOS. Apple blocks normal direct installs for unsigned `.ipa` files.

## iOS support

The project uses Capacitor 7. The target is iOS 14+ and Xcode 16+.
