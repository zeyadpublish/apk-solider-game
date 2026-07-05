# APK Online Setup

The Android APK needs a public API server URL for sign in, sign up, friends, leaderboard, and 1v1 multiplayer.

In Codemagic, open the app, then go to environment variables and add:

```text
FRONTLINE_API_BASE_URL=https://your-api-server-url
```

Use the server root URL, not a local address and not the APK file. For example, use `https://your-server.com`, not `localhost` and not `/api/auth/login`.

The API server also needs a real `DATABASE_URL` on the hosting website. Without the hosted API and database, Solo Play works but online login and multiplayer cannot work.
