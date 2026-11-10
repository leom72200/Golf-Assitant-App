# Golf Assistant

A mobile app that helps you track and improve your golf game: stock yardages for every club, swing and
ball-flight numbers from your phone's camera, GPS hole maps for public courses, and challenges that add
an extra layer of fun to a normal round.

Built with [Expo](https://expo.dev) (SDK 58) + React Native + TypeScript, for iOS and Android.

## Features

| Tab | What it does |
| --- | --- |
| **Home** | Round in progress, your stats (avg / best score, shots logged, challenge points), today's challenges, recent rounds. |
| **My Bag** | Every club with its *stock carry* (trimmed average of good shots), its 80% carry range, and a yardage-gapping bar chart. Edit which 14 clubs are in the bag. Tap a club for full stats: avg total, consistency, ball/club speed, smash factor, launch, spin, miss tendency. |
| **Shot Lab** | Your phone as a "sim sensor": a **live 240 fps practice mode** that hears each impact and measures **ball speed** and **launch angle** automatically, a manual analyzer for slow-motion clips, and a ball-flight calculator that turns ball speed + launch + spin (+ temperature and altitude) into carry, total, apex and landing angle. |
| **Courses** | Find golf courses near you (GPS) or by name from **OpenStreetMap**, download their hole maps for offline use, and play with live **front / center / back** yardages on a satellite map. Tap anywhere on the map to measure layups. Club suggestions come from your own stock yardages. |
| **Challenges** | **Round challenges** scored live from your scorecard (Fairway Finder, Lag Master, Hot Streak, Scrambler, Sandy, Par 3 Hero…), including club-of-your-choice ones like *One-Club Wonder* (par a hole using only your 7-iron) and *One-Club Legend* (birdie it). **Range challenges** run as a session with a club you pick: *Long Ball* (beat your longest carry), *Speed Session*, *Stock Sniper*, *Tight Group*, *Pure Strike*, *Dial It In*. Daily picks, points and levels. |

**Personal records** are tracked automatically: longest carry / total, fastest ball and club speed and best
smash factor per club, plus best 9- and 18-hole scores, fewest putts, most birdies, longest par streak,
most fairways and greens, and a best score for each course. Breaking a record when you log a shot pops a
celebration.

Rounds have a hole-by-hole scorecard (strokes, putts, fairway, penalties, bunker, one-club-only), and
challenge progress updates as you enter each hole.

## Getting started

```bash
npm install
npx expo start        # then scan the QR code with Expo Go, or press i / a for a simulator
```

Everything except the camera **practice mode** runs in **Expo Go**. Practice mode needs the app
built with its native camera module — see [Build for your phone](#build-for-your-phone-android).

**Android maps** need a Google Maps SDK key in standalone builds. Set it as an environment variable
(or an EAS secret). It is read in `app.config.ts` and never committed:

```bash
GOOGLE_MAPS_API_KEY=your-key npx expo run:android
```

iOS uses Apple Maps and needs no key.

### Checks

```bash
npm test              # unit tests (domain logic + state)
npm run typecheck     # TypeScript
npm run lint          # ESLint
```

## Camera practice mode (the "sim sensor")

**Shot Lab → Start practice mode.** Keep the camera open and just hit balls. For each shot the app:

1. films continuously at **240 fps** in short rolling clips (custom Android camera module,
   `modules/highspeed-camera`, using Camera2's constrained high-speed session),
2. **listens for the impact** through the microphone (`src/domain/impactDetector.ts`; audio is only
   used for timing and never saved),
3. stops the clip, pulls ~40 frames around impact and **tracks the ball automatically**
   (`src/domain/tracking.ts`, `src/domain/shotAnalyzer.ts`): finds the ball at address, notices when
   it leaves, picks out the fastest straight-line, constant-speed bright object (the ball always
   outruns the club head) and fits its path,
4. shows **ball speed, launch angle, estimated carry/total** and the flight, then re-arms.

Nothing is stored unless you tap **Save to My Bag** (or turn on "Save every shot").

**Setup:** phone sideways (landscape) on a tripod or the ground, about 2 m / 7 ft from the ball,
side-on so the ball flies across the screen, ball in the left or right third, good light. Tap
**Aim on the ball**, tap the ball in the picture, and start hitting. Calibration comes from the ball
itself (42.67 mm wide), measured at full resolution.

**Accuracy so far:** against synthetic swings rendered at 1080p, encoded as real 240 fps H.264 video and
analysed through the same pipeline, ball speed is within ~1% and launch angle within 0.1° (driver,
irons, wedge, heavy motion blur, either direction). Run it yourself with `npm run validate:tracking`
(needs ffmpeg). **Real-world accuracy still has to be checked on a phone**; lighting, background and
camera angle will matter.

**Limits:** side-on filming measures speed and vertical launch only — not left/right direction or
spin, so carry uses a typical spin for the club. Needs a phone that lets apps record at 120/240 fps
(e.g. Galaxy S21 and newer); iPhone support isn't written yet. 240 fps filming warms the phone up;
take breaks in long sessions.

### Manual clip analyzer

Shot Lab can also open a slow-motion clip from your gallery and let you mark the ball by hand (works in
Expo Go). The ball-flight calculator turns ball speed + launch + spin into carry, using a drag-and-lift
model that lands within ~7% of published tour-average carries.

## Shot tracer and unlockable styles

Every shot can be watched with a **tracer line that follows the ball**:

- **Flight tracer** (everywhere): a TV-style view from behind the golfer. The line is drawn as the ball
  flies, in real time (slightly sped up), then the roll-out and a landing marker, with carry/total/apex.
  The virtual camera fits itself to each shot so a high wedge and a long drive both fill the view. Shots
  with a left/right number curve toward where they finished.
- **Camera tracer** (practice mode): the ball's measured path drawn over a real frame from your shot,
  extended until it leaves the picture.
- **Replays**: tap **▶ Replay** on any logged shot in a club's history. Shots with only a carry distance
  get a flight shape that matches that carry.

**Tracer locker** (Challenges tab → 🎨 Tracer locker): styles unlock from your achievements, and a pop-up
tells you when you earn one.

| Style | How to unlock |
| --- | --- |
| Classic Red | From the start |
| Ice Blue | Complete any challenge |
| Record Breaker | Beat one of your personal records |
| Birdie Gold | Complete Birdie Hunter |
| Flame | Complete Hot Streak |
| Comet | Complete Long Ball |
| Neon Dash | Complete Tight Group |
| Lightning | Complete Speed Session |
| Rainbow | Complete One-Club Wonder (or Legend) |
| Royal Purple | Reach level 3 (300 challenge points) |
| Emerald | Finish 5 rounds |
| Champion Platinum | Reach level 5 and complete 10 challenges |

Unlocks are worked out from your rounds, sessions and shots (`src/domain/tracerStyles.ts`), so they
always match your history.

## Build for your phone (Android)

Practice mode contains custom native code, so it doesn't run in Expo Go. Build the app once with
Expo's free cloud build service (no Android Studio needed):

1. Create a free account at [expo.dev](https://expo.dev).
2. In this folder: `npm install`, then `npx eas-cli@latest login`.
3. Build: `npx eas-cli@latest build --profile development --platform android`
   (the first time it offers to create the project and an Android signing key — say yes).
4. When it finishes (~10–20 min) it prints a link and QR code. Open it on the phone, download the APK
   and install it (Android will ask you to allow installing apps from your browser).
5. On your computer run `npx expo start --dev-client`, then open the Golf Assistant app on the phone
   (same Wi-Fi) — it loads the latest code, and changes reload live.

Prefer an app that runs on its own, without the computer? Use `--profile preview` instead of
`development` in step 3.

## Course data

Course maps come from [OpenStreetMap](https://www.openstreetmap.org) via the Overpass API (geometry) and
Nominatim (name search). The app reads `leisure=golf_course` boundaries and the `golf=hole | green | tee |
bunker | water_hazard` features inside them. Each green, tee and hazard is matched to the nearest hole line.

- Coverage varies. Many courses are fully mapped, some only have a boundary. When a course has no holes
  mapped you can still keep score, and anyone can add the holes on openstreetmap.org.
- OSM data is © OpenStreetMap contributors under the **ODbL**. The attribution is shown wherever map
  data is displayed and must stay.
- Overpass and Nominatim are free community services with fair-use policies. Requests only happen when
  the user asks for them, and downloaded courses are cached on the device.

## Project structure

```
src/
  app/                    Screens (Expo Router: every file is a route)
    (tabs)/               Home, My Bag, Shot Lab, Courses, Challenges
    club/[id].tsx         Club stats + shot history
    shot/new.tsx          Log a shot (manual, or pre-filled from Shot Lab)
    lab/record.tsx        Camera swing recorder
    lab/analyze.tsx       Slow-mo frame-marking analyzer
    lab/practice.tsx      Live 240 fps practice mode
    shot/[id].tsx         Shot replay with tracer
    tracers.tsx           Tracer locker
    course/[id]/…         Course overview + GPS hole map
    round/…               New round + live scorecard
  domain/                 Pure TypeScript logic, no React, fully unit tested
    clubs.ts              Stock yardages, dispersion, smash factor, club suggestion
    launch.ts             Camera measurement maths + ball-flight physics model
    geo.ts                Distances, bearings, green front/center/back
    osm.ts                OpenStreetMap query building + parsing into courses/holes
    scoring.ts            Round summaries, GIR, up-and-downs
    challenges.ts         Challenge catalog + evaluation engine
    records.ts            Personal records
    tracerStyles.ts       Tracer styles and their unlock rules
    tracerProjection.ts   Tracer geometry (down-the-line camera, camera-frame path)
    shotFlight.ts         Rebuild a flight for any logged shot (for replays)
    tracking.ts           Ball detection + flight tracking on grayscale frames
    shotAnalyzer.ts       Per-shot analysis plan (coarse scan, fine frames, fit)
    impactDetector.ts     Hears the impact in microphone levels
  state/                  App state (reducer + on-device persistence via expo-sqlite)
  services/courseApi.ts   Network calls to Overpass / Nominatim
  components/             Shared UI
modules/highspeed-camera/ Local native module: Android 240 fps preview + recording (Kotlin)
scripts/                  validate-tracking-video.ts (end-to-end check with ffmpeg)
```

## Roadmap

**Sim sensor**
- [x] Automatic ball tracking at 240 fps with impact detection by sound (Android practice mode).
- [ ] Validate and tune on real swings (Galaxy S25+), incl. lighting/background edge cases.
- [ ] Faster frame decoding (native MediaCodec decoder instead of per-frame thumbnails).
- [ ] iPhone version of the 240 fps camera module.
- [ ] Club head speed by tracking the club head through the frames before impact.
- [ ] Down-the-line camera mode for start direction and curve.
- [ ] Optional Bluetooth integration with consumer launch monitors.

**Courses & play**
- [ ] Shot tracking on the course: drop a pin where each shot lands to log real on-course distances
      per club automatically.
- [ ] Hazard carry / lay-up distances listed per hole.
- [ ] Wind and elevation ("plays like") adjustments.
- [ ] Apple Watch / Wear OS yardages.

**Game & social**
- [ ] Handicap index (World Handicap System) from rounds with course rating / slope.
- [ ] Head-to-head and group challenges with friends, leaderboards (needs a backend + accounts).
- [ ] More formats: skins, Stableford, match play, "club roulette" honor-system challenges.
- [ ] Records from on-course shot tracking (longest drive in play, longest putt holed).
- [ ] Cloud backup and sync.
