# Deep links

Universal links (iOS) and App Links (Android) on your own short domain, store fallback for visitors
without the app, and deferred deep linking (open the right screen after install). No SDK and no
third party: the Firebase Dynamic Links gap, filled with a JSON endpoint and two association files
(ADR [0008](ADR/0008-deep-links.md)).

## The three pieces

| Piece                 | Who handles it                                           | Configured on               |
| --------------------- | -------------------------------------------------------- | --------------------------- |
| Association files     | the OS fetches them; the redirect handler serves them    | the domain (`apps`)         |
| Store routing         | the redirect, for visitors whose OS did not open the app | the link (`ios`, `android`) |
| Deferred deep linking | the redirect stores a handoff; your app claims it        | the link (`deepLink`)       |

When the app is installed, the OS opens it straight from the universal / app link and your server
never sees the request: the app receives `https://go.acme.com/{slug}` and routes it itself. Pieces
two and three cover everyone else.

## 1. Association files

Register your apps on the short domain:

```ts
await core.createDomain({
  hostname: "go.acme.com",
  apps: {
    ios: {
      appIds: ["ABCDE12345.com.acme.app"], // TEAMID.bundle.id
      paths: ["/product/*", "NOT /internal/*"], // optional; default: every path
    },
    android: [
      {
        packageName: "com.acme.app",
        sha256CertFingerprints: ["AB:CD:EF:…"], // your signing certificate(s)
      },
    ],
  },
});
```

The redirect handler then answers, on that host:

- `GET /.well-known/apple-app-site-association` (and the `.json` variant): `applinks.details` with
  your `appIDs` and `components` (one per path; a `NOT ` prefix becomes `exclude: true`), plus
  `webcredentials.apps`.
- `GET /.well-known/assetlinks.json`: one `delegate_permission/common.handle_all_urls` statement per
  Android app (fingerprints uppercased).

Both as `application/json`, never redirected, with `Cache-Control: public, max-age=3600`. A domain
without the matching config answers "not mine" (`null`), so your framework can serve its own file.
Apple and Google fetch these over HTTPS from your domain (Apple through its CDN, which caches): put
TLS in front and keep the files reachable without auth.

In the app, add the domain as an associated domain (`applinks:go.acme.com` in the iOS entitlements)
and an `autoVerify` intent filter for `https://go.acme.com` on Android.

Serving the files somewhere else? The builders are exported:

```ts
import { buildAppleAppSiteAssociation, buildAssetLinks } from "@xtandard/links/deeplinks";

buildAppleAppSiteAssociation({ appIds: ["ABCDE12345.com.acme.app"] });
buildAssetLinks([{ packageName: "com.acme.app", sha256CertFingerprints: ["AB:CD:…"] }]);
```

## 2. Store routing

```ts
await core.createLink({
  slug: "app",
  url: "https://acme.com/app", // desktop and everyone else
  ios: "https://apps.apple.com/app/id123456789",
  android: "https://play.google.com/store/apps/details?id=com.acme.app",
});
```

Requests that reach the server from iOS go to `link.ios`, from Android to `link.android`, before any
[rule](RULES.md) is evaluated. Unset, they fall through to rules and `link.url`.

**Install referrer.** Any destination that is a Google Play listing
(`https://play.google.com/store/apps/details…` or `market://details…`) gets
`&referrer=xl_id%3D{clickId}` appended (merged into an existing `referrer`). After install, the app
reads it once from the [Play Install Referrer API](https://developer.android.com/google/play/installreferrer)
and gets the exact click id. The App Store has no equivalent.

## 3. Deferred deep linking

The visitor taps `go.acme.com/p42` on a phone without the app, installs it from the store, opens
it, and lands on product 42 instead of the home screen.

```ts
await core.createLink({
  slug: "p42",
  url: "https://acme.com/product/42",
  ios: "https://apps.apple.com/app/id123456789",
  android: "https://play.google.com/store/apps/details?id=com.acme.app",
  deepLink: { path: "/product/42", deferred: true },
});
```

On every non-bot click from iOS or Android on such a link, the redirect stores a **handoff** in the
background: `{ clickId, linkId, path, url, os, expiresAt }`, kept for `deferredTtl` (core option,
default `"2h"`), keyed by click id and by a **fingerprint**: a daily-salted SHA-256 of the client IP
and the OS family. IPs are never stored.

On first launch the app makes one call to the short domain:

```http
POST https://go.acme.com/_links/deferred/claim
Content-Type: application/json

{ "clickId": "clk_01J…" }
```

- **Exact match**: send `clickId` when you have it (Android, from the install referrer).
- **Probabilistic match**: send `{}`. The server computes the fingerprint of the calling request
  (its IP and the OS family parsed from its `User-Agent`) and claims the newest unclaimed handoff
  with the same fingerprint inside the window.

```json
{
  "matched": true,
  "matchType": "exact",
  "clickId": "clk_01J…",
  "linkId": "lnk_01J…",
  "path": "/product/42",
  "url": "https://apps.apple.com/app/id123456789"
}
```

No match is `404 { "matched": false }`. A handoff can be claimed **once**. `path` is
`deepLink.path` (`/` when unset) and `url` is where the visitor was redirected. The endpoint lives
under the redirect handler's `basePath` when it has one (`/l/_links/deferred/claim`), needs no
auth, and is answered on registered domains (and, with `basePath`, on any host).

What makes the probabilistic match work, and what breaks it:

- **The same `privacy.salt` everywhere.** The fingerprint uses the daily salt. Without a configured
  `salt` it is random per process, so the claim must hit the very process that served the click.
  Set `privacy: { salt }` on every redirect handler ([Analytics](ANALYTICS.md#privacy)).
- **A client IP.** Behind a proxy, make sure `getIp` sees the visitor's address (the default reads
  `CF-Connecting-IP`, `X-Real-IP`, `X-Forwarded-For`, …). No IP, no fingerprint.
- **The OS family must parse.** The click came from a mobile browser (`ios` / `android`); the claim
  comes from your app's HTTP client. iOS `URLSession` sends `…CFNetwork/… Darwin/…`, which parses
  as `ios`. Android HTTP clients (`okhttp/…`, `Dalvik/…`) do not say "Android" reliably: set a
  `User-Agent` that contains `Android` on the claim request.
- **Same network.** Switching from Wi-Fi to cellular between tap and first open changes the IP.
  Probabilistic matches are labelled `matchType: "probabilistic"`: treat them as a good guess (for
  example, open the screen but do not apply a discount that only the link's audience should get).
- **Within the window** (2 hours by default) and the same UTC day (the salt rotates at midnight).

Expired and claimed handoffs are deleted by `core.prune()`; run it on a schedule.

### iOS (Swift)

```swift
import Foundation

struct DeferredLink: Decodable {
    let matched: Bool
    let matchType: String?
    let clickId: String?
    let path: String?
}

/// Call once, on the first launch after install.
func claimDeferredDeepLink() async -> DeferredLink? {
    let key = "xl.deferredClaimed"
    guard !UserDefaults.standard.bool(forKey: key) else { return nil }
    UserDefaults.standard.set(true, forKey: key)

    var request = URLRequest(url: URL(string: "https://go.acme.com/_links/deferred/claim")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = Data("{}".utf8) // probabilistic: there is no install referrer on iOS
    // URLSession's default User-Agent ("MyApp/1 CFNetwork/… Darwin/…") parses as iOS.

    guard let (data, response) = try? await URLSession.shared.data(for: request),
          (response as? HTTPURLResponse)?.statusCode == 200,
          let link = try? JSONDecoder().decode(DeferredLink.self, from: data),
          link.matched
    else { return nil }
    return link
}

// In your app's startup:
// if let link = await claimDeferredDeepLink(), let path = link.path { router.open(path) }
```

### Android (Kotlin)

```kotlin
import android.content.Context
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume

/** The click id from the Play install referrer ("xl_id=clk_…"), or null. */
suspend fun installReferrerClickId(context: Context): String? =
    suspendCancellableCoroutine { cont ->
        val client = InstallReferrerClient.newBuilder(context).build()
        client.startConnection(object : InstallReferrerStateListener {
            override fun onInstallReferrerSetupFinished(code: Int) {
                val id = if (code == InstallReferrerClient.InstallReferrerResponse.OK) {
                    client.installReferrer.installReferrer
                        .split("&").map { it.split("=", limit = 2) }
                        .firstOrNull { it[0] == "xl_id" }?.getOrNull(1)
                } else null
                client.endConnection()
                if (cont.isActive) cont.resume(id)
            }
            override fun onInstallReferrerServiceDisconnected() {
                if (cont.isActive) cont.resume(null)
            }
        })
    }

/** Call once, on the first launch after install. Returns the in-app path to open, or null. */
suspend fun claimDeferredDeepLink(context: Context): String? {
    val prefs = context.getSharedPreferences("xl", Context.MODE_PRIVATE)
    if (prefs.getBoolean("deferredClaimed", false)) return null
    prefs.edit().putBoolean("deferredClaimed", true).apply()

    val clickId = installReferrerClickId(context) // exact when present
    return withContext(Dispatchers.IO) {
        val conn = URL("https://go.acme.com/_links/deferred/claim").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            // Must contain "Android" for the probabilistic fallback to match the click's OS.
            conn.setRequestProperty("User-Agent", "AcmeApp/1.0 (Linux; Android ${android.os.Build.VERSION.RELEASE})")
            val body = JSONObject().apply { if (clickId != null) put("clickId", clickId) }
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            if (conn.responseCode != 200) return@withContext null
            val json = JSONObject(conn.inputStream.bufferedReader().readText())
            if (json.optBoolean("matched")) json.optString("path") else null
        } catch (e: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }
}
```

Add `com.android.installreferrer:installreferrer` to your dependencies.

## Attribution from the app

The claimed `clickId` is the click's id. When the link also has `trackConversions`, report the
in-app signup with `core.trackLead({ clickId, customerId })` (or `POST /api/track/lead`) and the
install is attributed to the link like any web conversion ([Conversions](CONVERSIONS.md)).
