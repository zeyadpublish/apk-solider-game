# Windows EXE Setup

The Windows version uses Electron and the existing web game bundle.

## What is included

- Desktop wrapper:

```text
release/frontline-uae-war-city-windows
```

- GitHub Actions workflow:

```text
.github/workflows/windows-exe.yml
```

The workflow creates a portable Windows `.exe`.

## How to build the EXE

1. Open the GitHub repository.
2. Click `Actions`.
3. Click `Build Windows EXE`.
4. Click `Run workflow`.
5. Select branch `main`.
6. Click the green `Run workflow` button.
7. Wait for the build to finish.
8. Open the completed workflow run.
9. Download the artifact:

```text
Frontline-UAE-War-City-Windows-EXE
```

Inside it will be:

```text
Frontline-UAE-War-City-1.0.0-Windows-x64.exe
```

## Online features

The EXE uses the hosted Replit API by default:

```text
https://frontline-game-host--zeyad0565615778.replit.app/api
```

The Electron wrapper serves the game locally and proxies HTTP API calls, so sign in, sign up, friends, and leaderboard can work from the desktop app.

## Windows warning

The EXE is not code-signed yet. Windows SmartScreen may warn users that the publisher is unknown.

For a professional public release, buy a Windows code-signing certificate and sign the EXE before publishing.

## Website download

After the EXE is built, upload it to GitHub Releases the same way as the APK.

Then add a PC download button on your website that points to the GitHub Release `.exe` file.
