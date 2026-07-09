# Frontline UAE War City - Windows

This folder builds the Windows desktop version with Electron.

The app loads the existing web game from:

```text
../frontline-uae-war-city-mobile/www
```

## Local build on a Windows machine with Node.js

```powershell
.\scripts\make-icon.ps1
npm install --package-lock=false --no-audit --no-fund
npm run dist
```

Output:

```text
dist/Frontline-UAE-War-City-1.0.0-Windows-x64.exe
```

## GitHub build

Use the repository workflow:

```text
Build Windows EXE
```

It uploads the EXE as a workflow artifact.
