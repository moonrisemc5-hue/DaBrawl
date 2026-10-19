# DaBrawl Android APK

This repository can build an Android debug APK that bundles the current DaBrawl web game.

## Build it

1. Open the repository on GitHub.
2. Go to **Actions** → **Build DaBrawl Android APK**.
3. Select **Run workflow** and run it on the default branch (or wait for a push that changes game/build files).
4. Open the completed workflow run and download the **DaBrawl-Android-APK** artifact.
5. Extract the ZIP and install `app-debug.apk` on the Android device. The device may ask to allow installs from that source.

The workflow also runs when the game or Android build files change on the default branch.

## Bundled vs online

The main HTML game, manifest and icon are copied into the APK at build time, so the game shell is packaged locally. DaBrawl still uses external online services for some features (including Supabase), and the Google font is remote, so internet access remains needed for online features and some remote resources. Updates to the website do not automatically update an installed APK; rebuild and reinstall a newer APK to ship local game changes.

This workflow creates a **debug APK** for direct testing and sharing, not a Play Store-signed release. Do not put private service-role keys or other secrets in the web game.
