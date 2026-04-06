# Vue 3 + Vite App

A Vue 3 + Vite single-page application with routing and interactive map-based views.

## Tech Stack
- Vue 3
- Vue Router (hash history)
- Vite
- Leaflet

## Prerequisites
- Node `22.12.0` (managed via `.nvmrc`)
- npm

## Run Locally

```bash
cd <your-project-directory>
nvm use
npm install
npm run dev
```

Open `http://localhost:5173/`.

## Build And Preview

```bash
npm run build
npm run preview
```

## Routes
- `#/` home page
- `#/basics` basics/info page
- `#/itinerary` itinerary page
- `#/photos` secure shared gallery (Supabase-backed)

## Project Structure
- `src/pages/` page-level views
- `src/components/` reusable UI and itinerary/map components
- `src/lib/` Supabase client and photo API helpers
- `src/router/index.js` route definitions
- `public/` static assets
- `supabase/` SQL migrations and edge functions for secure media APIs

## Secure Photos Setup

1. Create a Supabase project and enable Email authentication (magic link) in Supabase Auth.
2. Apply SQL migration in `supabase/migrations/`.
3. Deploy edge functions in `supabase/functions/`.
4. Add frontend env variables:

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

5. Configure function secrets:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
PROCESSOR_SECRET=<random-shared-secret>
IMAGE_MAX_BYTES=26214400
VIDEO_MAX_BYTES=52428800
```

The backend enforces a capture-date gate: media must be captured between July 31 and August 4, 2026 (Seattle time), based on image/video metadata.

## Development Conventions
See [`AGENTS.md`](./AGENTS.md) for:
- coding and workflow rules
- commit and PR title conventions
- quality gates and definition of done

## Troubleshooting
- If `npm run dev` fails with a Vite/Node version error, run:

```bash
nvm use
node -v
```

Expected Node version is `v22.12.0`.
