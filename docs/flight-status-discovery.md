# Real-Time Flight Status Discovery

## Current State

- Saved flight itinerary data lives in the `Flight Info` Google Sheet.
- `FlightsPage.vue` and `Itinerary.vue` read that sheet through the Google Visualization API.
- `lookup-flight` calls AeroDataBox through RapidAPI at `https://aerodatabox.p.rapidapi.com/flights/number/{flightNumber}` using `RAPIDAPI_KEY`.
- `lookup-flight` currently normalizes only scheduled date, scheduled departure time, scheduled arrival time, origin IATA, and destination IATA.
- Current sheet volume is 20 traveler rows and 11 unique flight legs. Live status should be fetched per unique leg, not per traveler row.

## Provider Findings

- AeroDataBox is already integrated and should remain the first provider to investigate because credentials and request plumbing exist.
- Probe result on June 25, 2026 confirmed the current AeroDataBox flight-number endpoint returns live operational fields. `AS554` returned `status: EnRoute`, revised departure time, and revised arrival time.
- The same probe hit `429` rate limits after the first flight when querying 10 flight numbers in one burst. V1 must avoid burst fan-out and should use cache-first, low-concurrency fetching.
- AeroDataBox flight-number lookups can return a current operational instance for the same flight number. Production status must only use a provider result when the requested route and local departure date match the saved itinerary row.
- The current endpoint returns richer fields than the app stores, but `lookup-flight` discards them.
- FlightAware AeroAPI is the fallback provider to compare if AeroDataBox cannot reliably return live operational fields. FlightAware describes AeroAPI as supporting current flight status, ETAs, last position, track, flight status, alerting, cancellations, diversions, and gate-related data, but it has separate pricing and rate limits.

## Provider Probe

During discovery, a temporary admin-only `flight-status-probe` Edge Function was used to query real saved flight numbers:

- Query real saved flight numbers from the current sheet:
  - `AS554`, `AS405`, `UA4974`, `UA2241`, `UA2835`, `UA1557`, `UA4996`, `UA2456`, `AF0829`, `AF0338`.
- Test flight number variants with and without spaces.
- Test date behavior for past, same-day, next-day, and trip-date flights.
- Inspect whether AeroDataBox returns:
  - `status`
  - scheduled, estimated, and actual departure times
  - scheduled, estimated, and actual arrival times
  - terminal, gate, baggage claim
  - cancellation, diversion, and codeshare metadata
- Record raw response examples for one on-time, one delayed, one landed, and one unavailable flight if available.

Observed probe output:

```txt
AS554 -> 200, resultCount=1, firstStatus=EnRoute,
  depRevised=2026-06-25 07:13-05:00,
  arrRevised=2026-06-25 08:42-07:00

All subsequent flights in the 10-flight burst -> 429
```

Browser console dry probe used during discovery:

```js
const session = JSON.parse(localStorage.getItem('friends-weekend-auth') || '{}')
const token = session.access_token || session.currentSession?.access_token

const probe = await fetch('https://ywvwbvklkriojuewzqds.supabase.co/functions/v1/flight-status-probe', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    flightNumbers: ['AS554', 'AS405', 'UA4974', 'UA2241', 'UA2835', 'UA1557', 'UA4996', 'UA2456', 'AF0829', 'AF0338'],
    includeRaw: false,
  }),
}).then((res) => res.json())

probe.results.map(({ flightNumber, ok, httpStatus, resultCount, summaries }) => ({
  flightNumber,
  ok,
  httpStatus,
  resultCount,
  firstStatus: summaries?.[0]?.status,
  depRevised: summaries?.[0]?.departure?.revisedLocal,
  depActual: summaries?.[0]?.departure?.actualLocal,
  arrRevised: summaries?.[0]?.arrival?.revisedLocal,
  arrActual: summaries?.[0]?.arrival?.actualLocal,
}))
```

The probe function was not kept as part of the production feature. Use the production `flight-status` endpoint for app behavior.

## Recommended Product Decisions

- Show live status on `/flights` first; keep `/itinerary` schedule-focused for v1 unless `/flights` proves useful.
- Treat "real time" as cached status refreshed on page load and via a manual refresh button.
- Add auto-refresh every 10 minutes only while the Flights page is visible, but fetch stale legs sequentially with a small delay to avoid RapidAPI burst limits.
- Display status subtly for normal states and prominently for disruptions:
  - `On time`
  - `Delayed`
  - `Boarding`
  - `Departed`
  - `Landed`
  - `Cancelled`
  - `Status unavailable`
- Include gate/terminal if the provider supplies it, but do not make it required for v1.
- Do not write live status back to Google Sheets.

## Data And Backend Design

Add a Supabase table `flight_status_cache`:

- `id uuid primary key`
- `flight_number text not null`
- `flight_date date not null`
- `origin text not null`
- `destination text not null`
- `provider text not null default 'aerodatabox'`
- `status text`
- `status_label text`
- `scheduled_departure_at timestamptz`
- `estimated_departure_at timestamptz`
- `actual_departure_at timestamptz`
- `scheduled_arrival_at timestamptz`
- `estimated_arrival_at timestamptz`
- `actual_arrival_at timestamptz`
- `departure_terminal text`
- `departure_gate text`
- `arrival_terminal text`
- `arrival_gate text`
- `baggage_claim text`
- `raw_payload jsonb not null default '{}'::jsonb`
- `fetched_at timestamptz not null default now()`
- `expires_at timestamptz not null`
- unique key on `(flight_number, flight_date, origin, destination, provider)`

RLS:

- Active members can select status cache rows.
- Writes happen only from service-role Edge Functions.

Add a Supabase Edge Function `flight-status`:

- Require active auth.
- Accept `legs: [{ flightNumber, date, origin, destination }]`.
- Deduplicate incoming legs server-side.
- Require an exact route and local departure date match before displaying operational status.
- Return one normalized status object per leg.
- Use cached rows when `expires_at > now()`.
- Fetch stale/missing rows from AeroDataBox sequentially or with concurrency `1`.
- Stop provider fan-out early if AeroDataBox returns `429`; return cached/stale statuses plus a top-level `rateLimited: true`.
- Store raw provider response and normalized status in `flight_status_cache`.
- Return partial results if one provider lookup fails.

Cache TTL:

- Trip-day or within 48 hours of departure: 10 minutes.
- More than 48 hours before departure: 6 hours.
- More than 12 hours after arrival: 24 hours.

## Frontend Design

- Reuse the existing grouped flight legs in `FlightsPage.vue`.
- Add a status fetch after `loadFlights()` completes.
- Merge statuses into grouped leg objects by `flightNumber + dateSort + origin + destination`.
- Show:
  - status badge
  - estimated/actual time if different from scheduled
  - gate/terminal line only when present
  - `Last updated X min ago`
  - refresh button in timeline/table header
- Keep map arcs unchanged.

## Usage Estimate

Current trip data:

- 20 traveler rows
- 11 unique legs

Worst case if every unique leg were refreshed continuously for 24 hours:

- 5-minute TTL: 3,168 provider calls/day
- 15-minute TTL: 1,056 provider calls/day
- 10-minute TTL: 1,584 provider calls/day

Recommended v1 avoids full-day polling for all flights by fetching only visible/upcoming legs and using a 10-minute TTL during the travel window.

Because the live probe hit `429` after one request in a burst, the first implementation should assume a strict short-window rate limit. Do not refresh all 11 current legs on every page load. Prefer:

- return cache immediately
- refresh at most one stale leg per function invocation, or
- refresh stale legs sequentially with backoff
- expose a clear `rateLimited` response to the UI

## Acceptance Criteria

- Existing static flight display still works when live status fails.
- Live status fetch never blocks the flight page from rendering.
- Provider API keys remain server-side only.
- Duplicate traveler rows do not create duplicate status calls.
- Disrupted flights are visually distinguishable from normal flights.
- Cached responses are reused across users.
- Build passes with Node `22.12.0`.
