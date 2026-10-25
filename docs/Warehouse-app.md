# Warehouse app (apps/dia-warehouse)

A phone-first web app (PWA) for depot and distributor staff. It answers "how full is my warehouse, what still fits,
what is about to expire, what do I load today" and lets staff record what is really on the shelf. Counts flow back
into the engine: the next space view and the next plan use them.

## Web and app together

One planning cycle runs across both, on one shared backend:

1. **Planner, web (:3000):** Plan → generate → *Send to distributors*.
2. **Distributor, app (:3002):** the order appears on **Orders** (badge on the tab); accept, trim or reject each line, or accept everything. The answer goes through the same route as the planner's Orders by city screen, so the same version checks and re-plan apply.
3. **Planner, web:** **Orders by city** shows the reply and the re-planned version; **Warehouses** shows every store's and godown's space (counted stock included) and a live feed of what staff recorded.
4. **Depot, app:** **Trucks** shows the loads of the latest sent version.

Both sides refresh every 15 seconds. The app follows the planner: it works on the scenario and day of the most recently **sent** plan (a later draft or what-if does not move it).

## Run it

`bun run dev` starts it with everything else. Open http://localhost:3002 (on a phone on the same Wi-Fi:
`http://<this PC's IP>:3002`, then "Add to home screen"). It talks only to the backend on :8000.

## Demo users (test accounts, demo data only)

Users are derived from the network: `planner`, one per depot (`w1-bhiwandi`, `n1-gurugram`, `s1-hosur`,
`e1-dankuni`) and one per distributor (`d01-pune` … `d16-guwahati`). All share the demo PIN set by `WH_DEMO_PIN`
in `.env` (default `1234`). Change it before showing the app outside the team.

| Role | Sees | Can change |
|---|---|---|
| Depot | its ambient store and cold room, and the godowns of the distributors it serves | its own stock |
| Distributor | its own godown | its own stock |
| Planner | every warehouse | any stock |

## Screens

| Screen | What it shows | Route |
|---|---|---|
| Space | capacity, used and free m³, % full per store and godown; tap for how many more cases of each product fit | `GET /v1/wh/space` |
| Stock | lots, oldest expiry first, days left; counted products marked | `GET /v1/wh/stock` |
| Alerts | lots likely to expire before they sell, with the advice | `GET /v1/wh/alerts` |
| Orders (distributor) | the order from today's sent plan; accept, trim or reject per line | `GET /v1/wh/orders`, `POST /v1/wh/orders/respond` |
| Trucks (depot, planner) | trucks to load today, oldest stock first | `GET /v1/wh/loading` |
| Record | count, receipt or adjustment (signed, e.g. −6 for damage); today's entries | `POST`/`GET /v1/wh/movements` |

Login: `GET /v1/wh/users`, `POST /v1/wh/login` (returns a bearer token), `GET /v1/wh/me`, `GET /v1/wh/day`.
Planner's web screen (no login, read-only): `GET /v1/scenarios/{id}/movements?as_of=` and the space route.

## How counts reach the plan

- A **count** sets the day's counted quantity of one product at one node; an **adjustment** moves it (starting from
  the system figure when nothing was counted yet); a **receipt** is recorded for the log and changes nothing.
- The backend keeps counted quantities per day (`stock_counts`) and sends them as `stock_counts` with every plan and
  every space request for that day. The engine (`counts.py`) scales that node's lots of the product to the count,
  keeping their expiry order, or adds a `COUNTED-…` lot when the system had none; godown free space follows.
- Trucks come only from plans **sent** to distributors that day; drafts and what-if plans never reach a loading list.

## Depot capacity

`supply.depot_storage_weeks` {ambient 3.5, chilled 0.6} × the region's weekly volume: measured peaks of 3.0–3.2
(ambient) and 0.40–0.55 (chilled) weeks on seed01 make the busiest week about 90% full. Display only: the optimiser
decides what leaves a depot, which only frees space, so depot space never limits a plan. Distributor godown space
does (constraint C6).

## Not built yet

Offline use (a service worker that queues entries), barcode scanning, per-user PINs or single sign-on (today: one
demo PIN), counts for days other than the app's day from the UI, and an app-store build (Expo can wrap these screens).
