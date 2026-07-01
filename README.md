# RecompTrack

RecompTrack is a lightweight personal web app for logging daily Omron body composition monitor readings. It runs as a Vite + React + TypeScript app, keeps an offline browser cache, syncs through Cloudflare D1, and uses a small Cloudflare function to proxy Gemini image extraction.

## Features

- Mobile-first tabs: Capture, Log, Trends, Backup/Settings
- Camera capture or image upload with local preview
- Gemini extraction through `POST /api/extract`
- AI results fill an editable draft form and are never saved automatically
- Validation highlights suspicious values before saving
- Offline local storage with automatic cross-device Cloudflare D1 sync
- JSON export/import and CSV export
- Responsive charts for weight, BMI, body fat, skeletal muscle, and visceral fat
- Automatic Mifflin-St Jeor resting-metabolism estimates from profile details and reading weight
- Read-only Google Health sync for Pixel Watch steps, sleep, activity, calories, resting heart rate, and HRV
- Photos are not stored by default

## Local Development

```bash
npm install
npm run dev
```

Open the printed local URL. To run the full Worker with local D1 and API routes:

```bash
npm run db:migrate:local
npm run dev:worker
```

## Cloud Sync Setup

Cloud sync uses one private household access key. Every device using that key shares the same profiles and readings. Local changes are queued while offline and retried on reconnect.

The production database binding is already configured in `wrangler.jsonc`. To recreate it in another Cloudflare account:

```bash
npx wrangler login
npm run db:create
```

2. Copy the returned `database_id` into `wrangler.jsonc`.

3. Apply the schema and create a strong access key:

```bash
npm run db:migrate:remote
openssl rand -hex 32
npx wrangler secret put APP_ACCESS_KEY
```

Enter the generated key under **Settings → Cloud sync** on both mobile and laptop. Keep it private: it grants access to the synchronized data.

## Google Health Setup

Google Health sync uses the Google Health API with a Web application OAuth client. The production callback is:

```text
https://bodyrecomposition-app.dpmanek.workers.dev/api/google-health/callback
```

Enable these read-only scopes on the Google Auth Platform **Data Access** page:

- `googlehealth.activity_and_fitness.readonly`
- `googlehealth.health_metrics_and_measurements.readonly`
- `googlehealth.sleep.readonly`

Apply the database migration and add the two server-only secrets:

```bash
npm run db:migrate:remote
npx wrangler secret put GOOGLE_HEALTH_CLIENT_SECRET
openssl rand -base64 32
npx wrangler secret put GOOGLE_HEALTH_TOKEN_KEY
```

Paste the generated base64 value into the final command. Refresh tokens are AES-GCM encrypted before they are stored in D1. The OAuth client ID and callback URL are non-secret variables in `wrangler.jsonc`.

For Cloudflare Pages, bind the same D1 database as `DB` in the Pages project settings and add `APP_ACCESS_KEY` as an encrypted secret.

## Gemini Setup

Create a Gemini API key in Google AI Studio, then set it as a server-side secret:

```bash
wrangler pages secret put GEMINI_API_KEY
```

Required sync key and extraction guard:

```bash
wrangler pages secret put APP_ACCESS_KEY
```

Requests to `/api/sync` and, when configured, `/api/extract` must include:

```text
x-app-access-key: your_shared_key
```

The key is stored in each device's browser and can be changed under **Settings → Cloud sync**.

## Deployment Notes

Cloudflare Pages works well for free or near-free hosting:

- Build command: `npm run build`
- Output directory: `dist`
- Functions directory: `functions`
- Secret: `GEMINI_API_KEY`
- Optional variable: `GEMINI_MODEL` defaults to `gemini-2.5-flash`
- Required for sync: D1 binding `DB`
- Required for sync: secret `APP_ACCESS_KEY`

The repo also includes `wrangler.jsonc` and `src/worker.ts` for Cloudflare Workers static-asset hosting on a `workers.dev` URL. Use `npm run build` and `wrangler deploy` for that path.

For Cloudflare Workers Git deployments, set the deploy command to:

```bash
npm run deploy
```

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
