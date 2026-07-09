const { app, BrowserWindow, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const REMOTE_API_BASE = (process.env.FRONTLINE_API_BASE_URL || "https://frontline-game-host--zeyad0565615778.replit.app/api").replace(/\/+$/, "");
const REMOTE_WS_BASE = (process.env.FRONTLINE_WS_BASE_URL || "wss://frontline-game-host--zeyad0565615778.replit.app/api/ws").replace(/\/+$/, "");

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".fbx", "application/octet-stream"],
  [".glb", "model/gltf-binary"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
]);

let localServer;
let localBaseUrl;

function getWebRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, "www");
  return path.resolve(__dirname, "..", "frontline-uae-war-city-mobile", "www");
}

function sendRuntimeConfig(res, port) {
  const localApi = `http://127.0.0.1:${port}/api`;
  const body = [
    `window.FRONTLINE_API_BASE_URL = ${JSON.stringify(localApi)};`,
    `window.FRONTLINE_WS_BASE_URL = ${JSON.stringify(REMOTE_WS_BASE)};`,
    "",
  ].join("\n");
  res.writeHead(200, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function proxyApi(req, res, requestUrl) {
  const apiPath = requestUrl.pathname.slice("/api".length) || "/";
  const target = new URL(`${REMOTE_API_BASE}${apiPath}${requestUrl.search}`);
  const headers = { ...req.headers, host: target.host, origin: new URL(REMOTE_API_BASE).origin };

  const proxy = https.request(
    target,
    {
      method: req.method,
      headers,
    },
    (remoteRes) => {
      const responseHeaders = { ...remoteRes.headers };
      delete responseHeaders["content-security-policy"];
      responseHeaders["access-control-allow-origin"] = "*";
      res.writeHead(remoteRes.statusCode || 502, responseHeaders);
      remoteRes.pipe(res);
    },
  );

  proxy.on("error", () => {
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Remote Frontline API is not reachable." }));
  });

  req.pipe(proxy);
}

function serveStatic(req, res, requestUrl, webRoot) {
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.normalize(path.join(webRoot, pathname));
  const normalizedRoot = path.normalize(webRoot + path.sep);

  if (!filePath.startsWith(normalizedRoot)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME_TYPES.get(ext) || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function startLocalServer() {
  const webRoot = getWebRoot();

  if (!fs.existsSync(path.join(webRoot, "index.html"))) {
    throw new Error(`Missing web build at ${webRoot}`);
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const port = server.address().port;
      const requestUrl = new URL(req.url || "/", `http://127.0.0.1:${port}`);

      if (requestUrl.pathname === "/frontline-runtime-config.js") {
        sendRuntimeConfig(res, port);
        return;
      }

      if (requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/")) {
        proxyApi(req, res, requestUrl);
        return;
      }

      serveStatic(req, res, requestUrl, webRoot);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      localServer = server;
      localBaseUrl = `http://127.0.0.1:${port}`;
      resolve(localBaseUrl);
    });
  });
}

async function createWindow() {
  const gameUrl = await startLocalServer();
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#080f0c",
    title: "Frontline UAE War City",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(localBaseUrl)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(localBaseUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  await win.loadURL(gameUrl);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (localServer) localServer.close();
  app.quit();
});
