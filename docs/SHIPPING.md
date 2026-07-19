# Shipping Declutter to the app stores

The project is configured for EAS (Expo Application Services) builds. Everything
below is one-time setup + repeatable commands.

## Already configured in this repo

- `app.json`: iOS `bundleIdentifier` + Android `package` = `com.kavita.declutter`
  (change freely before first submission — it must be globally unique and is
  permanent once an app ships under it), camera/microphone permission strings,
  iPad support (`supportsTablet`), white splash, light-only UI,
  `ITSAppUsesNonExemptEncryption: false` (skips the export-compliance prompt).
- `eas.json`: `development` / `preview` / `production` build profiles;
  production auto-increments build numbers.

## One-time setup

1. **Expo account** (free): `npx eas login` (create at expo.dev if needed).
2. **Apple Developer Program** ($99/yr): enroll at developer.apple.com — required
   for TestFlight and the App Store. EAS handles certificates/profiles
   automatically once you sign in during the build command.
3. **Google Play Console** ($25 one-time): play.google.com/console.
4. Link the project: `npx eas init` (writes the EAS project id into app.json).

## Build & submit

```bash
# iOS — cloud build (no Mac needed), then submit to TestFlight/App Store
npx eas build --platform ios --profile production
npx eas submit --platform ios

# Android — AAB build, then submit to Play Console
npx eas build --platform android --profile production
npx eas submit --platform android

# Internal testing on real devices before store review
npx eas build --platform ios --profile preview     # installable via link
npx eas build --platform android --profile preview # APK via link
```

## Before first store submission — required assets & policies

- [ ] **App icon**: replace the Expo placeholder icons in `assets/images/`
      (1024×1024 master; brass/navy Declutter mark). Stores reject default icons.
- [ ] **Screenshots**: iPhone 6.7" + 5.5", iPad 12.9" (App Store); phone +
      7"/10" tablet (Play). Take them from the preview build.
- [ ] **Privacy policy URL** (both stores require it). Content must cover:
      photos, voice recordings, on-device storage; no ads, no data sale.
      Host anywhere public (e.g. a static page).
- [ ] **App Privacy questionnaire** (App Store) / **Data safety form** (Play):
      currently truthful answers = all data stays on device, nothing collected.
      Must be re-answered when Supabase sync ships.
- [ ] Age rating questionnaires (4+ / Everyone).
- [ ] Support contact email/URL.

## Review-proofing notes

- The app works fully offline with local data — no login wall, so reviewers can
  use it immediately (good for approval).
- When Supabase + auth arrive: Apple requires **Sign in with Apple** whenever
  third-party login (Google) is offered — plan for both.
- The "demo view switch" rows (View as helper / View as owner) are fine for
  TestFlight but consider hiding them behind a dev flag for public release.

## Web deploy (bonus)

`npx expo export --platform web` outputs a static site in `dist/` — deployable
to Amplify/Vercel/Netlify as-is (same pattern as StockPulse's frontend).
