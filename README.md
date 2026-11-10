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
| **Shot Lab** | Your phone as a simple "sim sensor": record a swing, or analyze a slow-motion clip by marking the ball to measure **ball speed** and **launch angle**. A ball-flight calculator turns ball speed + launch + spin (+ temperature and altitude) into carry, total, apex and landing angle. |
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

All native modules used are part of the Expo SDK, so the app should run in **Expo Go**. For a production
build use EAS: `npx eas-cli@latest build`.

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

## How the camera "sim sensor" works (and its limits)

A real launch monitor uses radar or high-speed cameras running at thousands of frames per second.
A phone can get you useful numbers, with some caveats:

1. **Filming.** Put the phone side-on to the ball, about 2 m (7 ft) away, so the ball flies across the
   screen. Use the phone's **slow-motion** mode (240 fps if available). At normal 30 fps a 130 mph ball
   moves almost 2 m between frames and is gone before you can see it twice.
2. **Calibration.** In the analyzer, tap the left and right edges of the ball at address. A golf ball is
   42.67 mm wide, so this gives a pixels-to-metres scale in the ball's plane.
3. **Measurement.** Mark the ball's centre in two frames just after impact. Distance ÷ time gives
   **ball speed**, and the direction gives **launch angle** (`src/domain/launch.ts`).
4. **Ball flight.** Carry is *estimated* by simulating the flight with gravity, drag and backspin lift.
   Phone video can't measure spin, so a typical spin for the club's loft is used unless you enter one.
   The model comes within ~7% of published tour-average carries for driver through pitching wedge
   (this is covered by unit tests).

What this **can't** do yet: club head speed, spin, face angle, club path or side spin. See the roadmap.

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
    course/[id]/…         Course overview + GPS hole map
    round/…               New round + live scorecard
  domain/                 Pure TypeScript logic, no React, fully unit tested
    clubs.ts              Stock yardages, dispersion, smash factor, club suggestion
    launch.ts             Camera measurement maths + ball-flight physics model
    geo.ts                Distances, bearings, green front/center/back
    osm.ts                OpenStreetMap query building + parsing into courses/holes
    scoring.ts            Round summaries, GIR, up-and-downs
    challenges.ts         Challenge catalog + evaluation engine
  state/                  App state (reducer + on-device persistence via expo-sqlite)
  services/courseApi.ts   Network calls to Overpass / Nominatim
  components/             Shared UI
```

## Roadmap

**Sim sensor**
- [ ] Automatic ball tracking: replace manual marking with on-device detection. This needs
      `react-native-vision-camera` with frame processors for 120–240 fps capture (a dev build, not Expo Go).
- [ ] Detect the impact frame from the audio spike of impact (the recorder already captures audio).
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
