# Development Guide

## Stack
- Vue 3
- Vue Router (hash history)
- Vite
- Supabase (Auth, Storage, Edge Functions)
- Leaflet

## Local Development
```bash
nvm use
npm install
npm run dev
```

Default URL: `http://localhost:5173`

## Build
```bash
npm run build
npm run preview
```

## Routes
- `#/` Home
- `#/basics`
- `#/itinerary`
- `#/photos` (auth required)
- `#/login`

## Project Structure
- `src/pages` page views
- `src/components` reusable UI
- `src/lib` auth/media/API helpers
- `src/router/index.js` route guards and URL cleanup
- `supabase/` SQL, edge functions, backend docs

## Troubleshooting
Wrong Node version:
```bash
nvm use
node -v
npm -v
```
