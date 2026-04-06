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

## Project Structure
- `src/pages/` page-level views
- `src/components/` reusable UI and itinerary/map components
- `src/router/index.js` route definitions
- `public/` static assets

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
