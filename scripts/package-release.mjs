import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const outputRoot = process.env.FRONTLINE_OUTPUT_DIR
  ? path.resolve(process.env.FRONTLINE_OUTPUT_DIR)
  : path.resolve(repoRoot, "..", "..", "..", "outputs");
const releaseRoot = path.join(repoRoot, "release");

const webDist = path.join(repoRoot, "artifacts", "salute-frontline", "dist", "public");
const officialAssets = path.join(repoRoot, "artifacts", "salute-frontline", "public", "assets", "official");
const apiDist = path.join(repoRoot, "artifacts", "api-server", "dist");

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
}

function copyDir(source, target) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

function zipDirectory(sourceDir, zipPath) {
  rmSync(zipPath, { force: true });
  if (process.platform === "win32") {
    const sourceRoot = sourceDir.replaceAll("'", "''");
    const targetZip = zipPath.replaceAll("'", "''");
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$ErrorActionPreference = 'Stop'; $root = '${sourceRoot}'; Get-ChildItem -LiteralPath $root -Recurse -Force | ForEach-Object { if ($_.Attributes -band [System.IO.FileAttributes]::Hidden) { $_.Attributes = $_.Attributes -band (-bnot [System.IO.FileAttributes]::Hidden) } }; Compress-Archive -Path (Join-Path $root '*') -DestinationPath '${targetZip}' -Force`,
      ],
      { stdio: "inherit" },
    );
    return;
  }
  run("zip", ["-r", zipPath, "."], { cwd: sourceDir });
}

function writeReadme(file, body) {
  writeFileSync(file, `${body.trim()}\n`, "utf8");
}

run("pnpm", ["--filter", "@workspace/api-server", "build"]);
run("pnpm", ["--filter", "@workspace/salute-frontline", "build"]);

copyDir(officialAssets, path.join(webDist, "assets", "official"));

rmSync(releaseRoot, { recursive: true, force: true });
mkdirSync(releaseRoot, { recursive: true });
mkdirSync(outputRoot, { recursive: true });

const webRelease = path.join(releaseRoot, "frontline-uae-war-city-web");
copyDir(webDist, webRelease);
writeReadme(
  path.join(webRelease, "README.md"),
  `
# Frontline UAE War City - Web Build

Serve this folder from any static web host. For local iPad testing on the same Wi-Fi:

1. Run \`pnpm --filter @workspace/salute-frontline dev\`.
2. Open the Vite Network URL on the iPad.

Sign-in, friends, and challenges require the API server plus a real Postgres \`DATABASE_URL\`.
Guest Solo Play with AI runs directly from the web build.
`,
);

const apiRelease = path.join(releaseRoot, "frontline-uae-war-city-api");
copyDir(apiDist, apiRelease);
cpSync(path.join(repoRoot, "artifacts", "api-server", "package.json"), path.join(apiRelease, "package.json"));
writeReadme(
  path.join(apiRelease, "README.md"),
  `
# Frontline UAE War City - API Server

Required environment variables:

- \`PORT\`: API port, for example \`8787\`.
- \`DATABASE_URL\`: real Postgres connection string.

Before first production use, run the Drizzle schema push from the workspace:

\`\`\`powershell
pnpm --filter @workspace/db push
\`\`\`

Start:

\`\`\`powershell
$env:PORT="8787"
$env:DATABASE_URL="postgres://..."
node --enable-source-maps ./index.mjs
\`\`\`
`,
);

const steamRelease = path.join(releaseRoot, "frontline-uae-war-city-steam");
copyDir(webDist, path.join(steamRelease, "public"));
writeReadme(
  path.join(steamRelease, "README.md"),
  `
# Steam Release Handoff

This package contains the production web build under \`public/\`.

To upload to Steam, wrap this web build in your Steamworks-approved desktop shell or Electron/Tauri project, set your real Steam App ID in SteamPipe, then upload through Valve's SDK. The repository does not include fake Steam IDs or signing credentials.
`,
);

const mobileRelease = path.join(releaseRoot, "frontline-uae-war-city-mobile");
copyDir(webDist, path.join(mobileRelease, "www"));
writeFileSync(
  path.join(mobileRelease, "capacitor.config.json"),
  JSON.stringify(
    {
      appId: "com.zeyadmamdouh.frontline",
      appName: "Frontline UAE War City",
      webDir: "www",
      server: { androidScheme: "https" },
    },
    null,
    2,
  ),
);
writeReadme(
  path.join(mobileRelease, "README.md"),
  `
# App Store / Google Play Handoff

This folder contains a Capacitor-ready web bundle:

- \`www/\`: production game build
- \`capacitor.config.json\`: native wrapper config

To produce real App Store / Google Play uploads, use your Apple Developer / Google Play accounts and signing certificates:

\`\`\`powershell
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android
npx cap sync
\`\`\`

Then build and sign in Xcode for App Store, and Android Studio/Gradle for Google Play. Store uploads cannot be generated truthfully without those account-specific signing assets.
`,
);

const packages = [
  [webRelease, path.join(outputRoot, "frontline-uae-war-city-web.zip")],
  [apiRelease, path.join(outputRoot, "frontline-uae-war-city-api.zip")],
  [steamRelease, path.join(outputRoot, "frontline-uae-war-city-steam-handoff.zip")],
  [mobileRelease, path.join(outputRoot, "frontline-uae-war-city-mobile-handoff.zip")],
];

for (const [source, zipPath] of packages) {
  zipDirectory(source, zipPath);
}

writeReadme(
  path.join(outputRoot, "frontline-local-ipad-url.txt"),
  `
Frontline UAE War City local iPad URL

Run the local server:

pnpm --filter @workspace/salute-frontline preview

Then open the Vite Network URL on your iPad or laptop, for example:

http://YOUR-WIFI-IP:5173/

Your Wi-Fi IP can change when the network reconnects. Use the Network URL printed by Vite for the exact current address.
`,
);

console.log(`Release packages written to ${outputRoot}`);
