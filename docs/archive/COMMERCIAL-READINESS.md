# Going commercial: what actually blocks it

Research completed 2026-08-09 against primary sources (Apple/Google developer docs,
statute text, provider API docs). Items the researcher could not verify are marked
**UNVERIFIED** — treat those as questions, not findings.

---

## 1. Three findings that change the plan

### 1.1 Google Photos date-based suggestion is impossible. The code in this repo depends on it.

Google removed `photoslibrary.readonly`, `photoslibrary.sharing` and `photoslibrary`
on **31 March 2025**: *"After March 31, 2025, you will only be able to access content
created by your application."*
([authorization](https://developers.google.com/photos/overview/authorization))

The Picker API that replaced it returns **no GPS**. Its entire `MediaFileMetadata`
schema is `width`, `height`, `cameraMake`, `cameraModel`, plus `focalLength`,
`apertureFNumber`, `isoEquivalent`, `exposureTime`
([reference](https://developers.google.com/photos/picker/reference/rest/v1/mediaItems)).
And it is session-based — create a session, hand the user a `pickerUri`, poll for the
result. **There is no unattended backfill and no search by date or location.**

**What this breaks:** `supabase/functions/google-photos-token/index.ts` and the
`google_tokens` table are built on a model that no longer exists. More importantly it
kills the feature as described — "show me photos from the day of this hike" cannot be
answered by Google Photos. The user must pick photos manually, every time.

**The replacement is the on-device photo library**, which is the only remaining source
of GPS EXIF — and that means the native app (§2), not the web app.

### 1.2 Strava forbids showing Josh's data to Erica

The [API Agreement](https://www.strava.com/legal/api) Highlights:

> "Strava Data provided by a specific user can only be displayed or disclosed in your
> Developer Application to that user."
> "Strava Data related to other users, even if such data is publicly viewable on the
> Strava Platform, may not be displayed or disclosed."
> "You may not create applications that compete with or replicate Strava functionality."

A shared map where Erica sees Josh's Strava-derived activities is prohibited by the
first two. The whole two-person model — the thing this app *is* — conflicts with it.

Compounding it: **the default cap is 10 athletes.** *"All new applications start in
single-player mode"*, then *"Athlete capacity of 10"*, and beyond that you must
*"submit your app for review"* — with *"increased access is not a guarantee"*
([rate limits](https://developers.strava.com/docs/rate-limits/)). Rate limits are
**per application, not per user**, so one person's backfill starves everyone.

§4.4 binds you on exit: *"Upon termination… you must promptly cease using and
permanently delete… all Strava Data."*

**Correction to what I said earlier.** I relayed that §6.2 bans 7-day retention, §5.7
bans storing location and §5.3 bans AI use. **Those specific numbered clauses were not
found in the agreement.** The real restrictions are the sharing ones quoted above,
which are in the Highlights section. The earlier numbers should not be relied on.

**Route through it:** import Strava as *user-owned track records* the user then chooses
to share, rather than presenting it as Strava data — and get that reviewed by a lawyer
before selling anything. Make Garmin, HealthKit/Health Connect and plain GPX/FIT upload
the primary paths so Strava is a convenience, not a dependency. 265 of 445 activities
already arrive by file import, so this is a smaller change than it sounds.

### 1.3 There is a Play deadline 22 days out

- **31 Aug 2026** — *"New apps and app updates must target Android 16 (API level 36) or
  higher"* ([target API](https://support.google.com/googleplay/android-developer/answer/11926878)).
  Extension available to 1 Nov 2026.
- **September 2026** — Apple: *"responses will be required when submitting new apps or
  updates"* for the new social-media age-rating questions.
- **Late Oct 2026** — Play's Location Button enforcement at API 37, which names our
  exact use case: *"Location Tagging: Attaching a location to user-generated content
  like photos."*

---

## 2. The technical route: Capacitor 8

**Not Expo. Not PWA-only.**

| | Capacitor 8 | Expo SDK 57 | PWA + TWA |
|---|---|---|---|
| Existing React + MapLibre GL JS | **~100% survives** | ~0% of view code | 100% |
| MapLibre | GL JS unchanged in the WebView | native, but **all map code rewritten** | unchanged |
| Background location | plugin, ~$399 | free, first-party | **spec-forbidden** |
| Photo EXIF GPS | `@capacitor/camera` `exif` | richest | iOS may strip |
| Apple 4.2 rejection risk | low | lowest | **high** |

**Why not PWA-only:** the [Geolocation API](https://www.w3.org/TR/geolocation/) §6.5 is
normative — if the page is not visible, `watchPosition` stops. In every browser. And
Safari deletes script-created storage after seven days without interaction, which kills
offline tiles.

**Why not Expo:** it wins on location and EXIF, but rewriting every screen and all
MapLibre interaction to avoid a $399 plugin is a bad trade.

### Background location: native records, JS reads later

`@capacitor/geolocation` *"does not support background geolocation directly"*, and
`@capacitor/background-runner` is not a substitute (iOS gives ~30s; *"State is not
maintained between calls"*). Apple:

> "the system suspends the execution of most apps shortly after they move to the
> background… the system enqueues location updates and delivers them when the app runs
> again."

The `location` background mode keeps the **native process** alive, not the WebView's
JavaScript. So: native `CLLocationManager` / Android foreground service → write fixes
to **native SQLite** → upload over **native HTTP** (Android throttles WebView requests
after 5 minutes backgrounded) → flush to React on foreground.

**Buy `@transistorsoft/capacitor-background-geolocation`** — $399 for one app,
perpetual. This also lets us retire the Overland dependency in
`supabase/functions/ingest-overland`.

### Costs

Apple $99/yr · Play $25 once · Transistor $399 · Apple review *"90% … less than 24
hours"* · Play has no SLA, and **new personal accounts must run a 14-day closed test
with 12 testers** — register as an **organization** to skip that.

---

## 3. Store-blocking checklist

### Already broken in this repo

- [ ] **No account deletion exists.** Apple 5.1.1(v) requires it in-app; Play requires
      in-app **and** a public web URL. *"Temporary account deactivation… does not
      qualify."* This is a same-day rejection.
- [ ] **`strava_accounts.profile_id` is `on delete set null`** (`0004_strava.sql`) —
      deleting a profile **orphans a live OAuth token**. Must be `on delete cascade`
      plus upstream revocation.
- [ ] **`strava-webhook` never handles deauthorization.** Strava sends it as an
      `athlete` update with `"authorized": "false"`. Not handling it breaches §4.4.
- [ ] **OAuth tokens are plaintext `text` columns** in `google_tokens` and
      `strava_accounts`. RLS denies access, but a service-role key leak exposes every
      token.

### Apple

- [ ] **Privacy manifest is mandatory — Capacitor is on Apple's named SDK list.** Ship
      `PrivacyInfo.xcprivacy`.
- [ ] **Guideline 4.2** — must be more than a repackaged website. Native background
      location, photo-library EXIF and push are what clear it; show them in first-run
      and in the screenshots.
- [ ] **Route external links to `SFSafariViewController`**, not the in-app WebView —
      *"Unrestricted Web Access"* forces a **16+** rating. A social feed forces 13+.
- [ ] **Purpose strings** for location (when-in-use *and* always), photo library, photo
      add, and health.
- [ ] **Privacy nutrition labels** — *"Precise Location… three or more decimal places"*.
      Every coordinate qualifies. Declare Linked to You, Not Used to Track.
- [ ] **Guideline 1.2** once any sharing exists: filtering, reporting, blocking, and
      published contact information.
- [ ] Sign in with Apple is **not** triggered if primary auth stays Supabase
      email/password. Connecting Strava later is a feature, not primary auth.

### Google Play

- [ ] **Target API 36 by 31 Aug 2026.**
- [ ] **Background location declaration** — one feature only, a ≤30s video, and the
      exact disclosure dialog *before* the runtime prompt. *"cannot only be placed in a
      privacy policy"*.
- [ ] **Use the Android Photo Picker; do not ship `READ_MEDIA_IMAGES`.** Enforcement has
      been live since 28 May 2025 — *"all apps are subject to removal."*
- [ ] **Data safety:** a photo with GPS EXIF is **both** "Photos" **and** "Precise
      location". Stripping the visible pin doesn't exempt you if the EXIF is retained.
- [ ] **Health apps declaration** — *"If your app is not primarily a health app, but has
      health-related features and accesses health data, it is still in scope."*
- [ ] **UGC**: report and block, plus a ToS gate, if open invites are public.

---

## 4. Integrations marketplace

**Model:** one platform OAuth client, per-user tokens. Customers do not register their
own apps. Native OAuth must follow [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) —
no embedded user-agents, PKCE required, client secret stays server-side in an Edge
Function. Disconnect must call the provider's revocation endpoint
([RFC 7009](https://www.rfc-editor.org/rfc/rfc7009)).

**Schema** (full DDL in the research transcript; the shape that matters):

- `integration_providers` — static catalogue
- `integration_connections` — one per (user, provider); public-safe metadata only
- `integration_credentials` — **separate table, service_role only, encrypted at rest**,
  with a `key_id` so keys can be rotated
- `sync_cursors` — incremental position per stream
- `sync_runs` — every attempt, with `partial` as a first-class outcome
- **`imported_objects`** — the provenance ledger: which external object produced which
  local row, with `user_edited` so hand-edits survive a re-sync. **This is what makes
  disconnect-and-purge possible**, and it is the same idea as `approved_fields` in the
  ingest rebuild.
- `provider_webhook_events` — idempotent fan-in

**Webhooks must ACK in 2 seconds** (Strava's handshake requirement), so the handler does
exactly one thing: insert the event and return 200. A separate worker drains the queue.
Never call a provider API inside the webhook handler.

**Rate-limit isolation:** Strava's limits are per application. Enforce a global token
bucket keyed on provider, with per-connection fair share on top.

**Formats:** FIT (richest — GPS, HR, power, laps; `@garmin/fitsdk` already shipped),
GPX 1.1 as the canonical internal track format and the DSAR export artifact, TCX where
FIT isn't available. No openEHR — that's clinical, and it drags us further into
"health app" territory we want to stay out of.

---

## 5. The five real risks, ranked

1. **Strava's sharing restriction is incompatible with the core product**, and the
   10-athlete cap blocks launch outright with no appeal. Mitigate by making Strava
   optional and getting the sharing model reviewed by counsel.
2. **A DPIA is legally required and hasn't been done.** GDPR Art. 35(1) — continuous
   location is systematic monitoring. CCPA §1798.140(ae) makes precise geolocation
   **sensitive personal information** (within 1,850 feet). Imported heart-rate data is
   Art. 9 special category, needing **explicit consent**. CPPA risk-assessment
   regulations took effect 1 Jan 2026 — thresholds and filing deadlines **UNVERIFIED**.
3. **Account deletion is absent and token cleanup is broken** — a store rejection and a
   live Art. 17 failure. One-month response deadline under Art. 12(3).
4. **Google Photos**: the repo's integration cannot work, and the obvious Android
   workaround (`READ_MEDIA_IMAGES` to scan the roll) violates Play policy.
5. **Public open invites** make this a moderated UGC platform *and* publish where a
   named person will be at a given time — a stalking vector. Coarsen public locations,
   require approval to join, ship report/block before the feature.

**Subprocessors are fine.** Supabase and Cloudflare both have self-serve DPAs with EU
SCCs and UK Addendum. Note R2's EU jurisdiction *"cannot be changed"* once set — decide
before there are EU customers.

---

## 6. Sequence

- **Before 31 Aug:** decide Capacitor; stand up the shell at API 36; **ship account
  deletion + DSAR export** (needed on the web app anyway); fix the
  `on delete set null` bug; encrypt tokens.
- **September:** Apple age-rating questionnaire, privacy manifest, purpose strings,
  nutrition labels; Play data-safety and health declarations. Buy the Transistor plugin,
  retire Overland.
- **Oct–Nov:** rebuild the integrations layer on the schema above; add Strava deauth
  handling; re-scope Google Photos to picker-only. **Apply for the Strava athlete-cap
  increase early — it is the long pole.**
- **Before public plans ship:** report/block/filter, coarsened public locations, a
  moderation runbook, and the DPIA.
