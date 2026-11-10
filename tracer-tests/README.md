# Shot Tracer field-test data

Upload exported Shot Tracer tests here so the tracer can be tuned on real footage.

## On the phone

1. Shot Tracer → turn on **Test mode**.
2. Hit shots. After each replay, fill in the **Test notes** (did the tracer match, the shape, roughly
   where it landed; phone distance and height once) and tap **Save test + next**.
3. Shot Tracer → **Tracer tests** → **Share report** (one JSON file), and **Share clip** for the shots
   you want to include. Save them to your Files / Google Drive.

## Upload here

On github.com (phone browser works), open this repository → this `tracer-tests` folder →
**Add file → Upload files**, add the report and clips (each file up to 25 MB), and commit.
Put each batch in its own subfolder, e.g. `2026-11-15-range/`.

## Analyse

```bash
npx tsx scripts/analyze-tracer-tests.ts tracer-tests/2026-11-15-range/tracer-tests-2026-11-15.json
```

This re-runs detection on the real frames, compares it with the app and your notes, and writes contact
sheets of the frames around impact to `analysis/`.
