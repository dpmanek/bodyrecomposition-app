# RecompTrack

RecompTrack is a lightweight personal web app for logging daily Omron body composition monitor readings. It runs as a Vite + React + TypeScript app, stores entries in the browser, and uses a small Cloudflare Pages-compatible function to proxy Gemini image extraction.

## Features

- Mobile-first tabs: Capture, Log, Trends, Backup/Settings
- Camera capture or image upload with local preview
- Gemini extraction through `POST /api/extract`
- AI results fill an editable draft form and are never saved automatically
- Validation highlights suspicious values before saving
- Local browser storage only, with create/edit/delete
- JSON export/import and CSV export
- Responsive charts for weight, BMI, body fat, skeletal muscle, and visceral fat
- Photos are not stored by default

## Local Development

```bash
npm install
npm run dev
```

Open the printed local URL. For full `/api/extract` testing, run on Cloudflare Pages or with Wrangler Pages so the `functions/api/extract.ts` endpoint is available.

## Gemini Setup

Create a Gemini API key in Google AI Studio, then set it as a server-side secret:

```bash
wrangler pages secret put GEMINI_API_KEY
```

Optional public-use guard:

```bash
wrangler pages secret put APP_ACCESS_KEY
```

When `APP_ACCESS_KEY` is set, requests to `/api/extract` must include:

```text
x-app-access-key: your_shared_key
```

The app currently calls `/api/extract` directly. If you enable `APP_ACCESS_KEY`, add a tiny UI setting or deployment-level header injection before public use.

## Deployment Notes

Cloudflare Pages works well for free or near-free hosting:

- Build command: `npm run build`
- Output directory: `dist`
- Functions directory: `functions`
- Secret: `GEMINI_API_KEY`
- Optional variable: `GEMINI_MODEL` defaults to `gemini-2.5-flash`
- Optional secret: `APP_ACCESS_KEY`

## Data Model

Each saved entry contains:

- `capturedAt`
- `weight`
- `weightUnit`
- `bmi`
- `bodyFatPercent`
- `skeletalMusclePercent`
- `visceralFatLevel`
- `restingMetabolismKcal`
- `bodyAgeYears`
- `notes`
- `source`

## Validation Ranges

- Weight must be greater than 0
- BMI: 5-80
- Body fat: 1-75%
- Skeletal muscle: 1-75%
- Visceral fat: 1-30
- Resting metabolism: 500-5000 kcal
- Body age: 1-120

These ranges highlight suspicious values for review; they do not prevent saving.
