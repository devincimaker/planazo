### iOS Simulator

**CRITICAL:** Always use the simulator specified in `apps/mobile/.env` (`IOS_SIMULATOR`). Never use a different simulator, even if:
- Another simulator is already booted
- The assigned simulator appears to be in use
- The assigned simulator is shut down (boot it first)

Read the `.env` file to get the simulator name, then use that exact simulator for all operations.

#### Building and Launching

**Always use `--no-bundler`** when building with Expo to prevent deep link issues that can launch the app on the wrong simulator:

```bash
# 1. Get the simulator UDID
UDID=$(xcrun simctl list devices | grep "$IOS_SIMULATOR (" | head -1 | grep -oE '[A-F0-9-]{36}')

# 2. Build and install (without launching via deep link)
cd apps/mobile && npx expo run:ios --device "$IOS_SIMULATOR" --no-bundler

# 3. Start Metro on the configured port (if not already running)
npx expo start --port $EXPO_PORT &

# 4. Launch the app with a deep link to the correct Metro port
xcrun simctl openurl "$UDID" "com.planazo.app://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$EXPO_PORT"
```

**Why?**
- Expo's deep links can open on any booted simulator with the app installed, not the one you specified. Using `--no-bundler` and launching by UDID ensures the correct simulator.
- The Dev Client discovers all Metro bundlers on the network. Using `openurl` with the specific port URL forces it to connect to the correct one instead of showing a picker or auto-connecting to the wrong server.
- If `EXPO_PORT` is occupied by another project's Metro (other apps in ~/Solopreneur run their own), start Metro on a free port instead and put that port in the `openurl` URL — do not kill the other project's bundler.

#### Native Packages Require Rebuild

The `ios` folder is **gitignored** and not tracked in version control. When adding a package with native code, you must rebuild the iOS app:

```bash
cd apps/mobile && npx expo run:ios --device "$IOS_SIMULATOR" --no-bundler
```

**Packages that require native rebuild:**
- `expo-image-picker`, `expo-camera`, `expo-location`, `expo-notifications`
- Any `expo-*` package that accesses device hardware or OS APIs
- React Native packages with native modules (check if they have `ios/` or `android/` folders)

**Packages that DON'T require rebuild:**
- Pure JS packages: `lodash`, `date-fns`, `zustand`, `zod`
- Expo packages without native code: `expo-router`, `expo-linking`

If you see an error like `Cannot find native module 'ExponentXxx'`, it means a native rebuild is needed.
