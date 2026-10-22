# Operations Control Center — clean-room rebuild

Next.js 16 (App Router) + React 19 + TypeScript. All 17 sidebar pages, a backend (Next.js route
handlers over a persistent file-backed store), and a stub login. Specified in `../SPEC.md` (the dashboard)
and `../SPEC-FULL.md` plus `../spec/*.md` (everything else).

**Read this first:** the original application was only observed through its shipped front-end code and one
dashboard screenshot. Its backend, business rules and response schemas are unknown. Every rule, KPI definition,
number and response shape in this codebase is our own design, and several screens have no original
reference at all. Each module spec says exactly which. Nothing here connects to Business Central, an external
pricing app, email, or an AI model: those parts are local, deterministic simulations and say so in the UI.

## Run

```
npm install
npm run dev              # http://localhost:3000
npm run build && npm start
npm test                 # Vitest + Testing Library, runs pages against the real route handlers
npm run typecheck
```

Sign in with `alex.morgan@example.com` / `demo1234` (also `pat.planner@…`, `bo.buyer@…`, same password).
Data persists in `.data/store.json` (override the folder with `APP_DATA_DIR`; delete it to reset to the seed).
Set `AUTH_SECRET` to change the cookie-signing secret. The login is demo-grade; do not use it to protect real data.

## Deploy to Render

The repository includes `render.yaml`, so it can be deployed as a Render Blueprint. In Render, choose
**New > Blueprint**, connect this repository, and apply the detected Blueprint. It creates a Node web service,
generates `AUTH_SECRET`, uses `/api/health` for health checks, and mounts a 1 GB persistent disk at `/var/data`.

The disk is intentional: this application stores its mutable state in a JSON file. Only one service instance can
use that disk, so this deployment must remain single-instance. The configured Render compute plan and disk are
paid resources. For a disposable free demo, remove `plan`, `disk`, and `APP_DATA_DIR` from `render.yaml`; all
changes made in the app will then be lost whenever Render restarts or redeploys the service.

For a manual Render web-service setup, leave the root directory empty, use `npm ci && npm run build` as the build
command, `npm start` as the start command, and `/api/health` as the health-check path. Set `AUTH_SECRET` to
a long random value. If data must survive restarts, mount a disk at `/var/data` and set `APP_DATA_DIR=/var/data`.

## Layout

| Path | Role |
|---|---|
| `src/server/` | Backend foundation: `store`, `http` (`handle()`), `auth`, `audit`, `clock`, `master/` (seed data), `plan.ts` (health and KPI rules), `simulate.ts` |
| `src/server/modules/<m>/` | Business logic per module: pricing, sop, supply, warehouse, production, ai, finance, admin, purchasing |
| `src/app/api/**/route.ts` | Thin route handlers, all written with `handle()` |
| `src/features/<m>/` | Client pages per module (each has its own `api.ts` over `src/lib/api/request.ts`, the only code that calls `fetch`) |
| `src/app/<route>/page.tsx` | Thin page files |
| `src/components/`, `src/state/` | App shell, dashboard, plan/session state |
| `src/proxy.ts` | Gate: everything except the auth pages and `/api/auth/*` needs a session |
| `tests/` | `tests/<m>/` per module; `tests/support/inprocess.ts` runs `request()` straight into the route handlers |
| `../spec/` | One spec per module (requirement IDs, V/I/U/P evidence tags, acceptance criteria, open questions) |

## Conventions that tests enforce (`tests/architecture.test.ts`)

Every route uses `handle()`; routes import no client code; client code never imports `@/server/*`; `fetch(` appears
only in `src/lib/api/request.ts`; components hold no brand names (branding is in `src/config/branding.ts`).

## Known limits

- No Ask Fluid chat (the button is inert). No real integrations. No XLSX upload (CSV only).
- Pages without original reference (gantt, capacity, costing, finance, finance-ops, admin, settings, releases)
  show a visible "reconstruction" notice.
- Simulated AI agent runs advance only when the cockpit calls `POST /api/ai/runs/tick`; `GET /api/ai/runs` is a pure read.
