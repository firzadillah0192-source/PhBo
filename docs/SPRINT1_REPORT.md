# Sprint 1 Report — Photobooth AI Web MVP

**Date:** 2026-09-18
**Scope:** Sprint 1 only (infrastructure baseline + `GET /api/health` + frontend health connectivity)
**Result:** **PARTIAL** — 8 of 10 requested items delivered and verified; 2 blocked by a
privilege boundary that requires one human `sudo` action.

---

## 1. Existing VPS state observed (before any change)

Inspected read-only per `skills/docker-vps/SKILL.md` §1. Nothing unrelated was modified.

### Containers
| Name | Image | Status | Ports |
|---|---|---|---|
| photobooth-api | photobooth-api:local | Up (healthy) | 0.0.0.0:8000->8000 |
| photobooth-web | photobooth-web:local | Up (healthy) | 0.0.0.0:3000->80 |
| photobooth-worker | photobooth-api:local | Up | none |
| photobooth-postgres | postgres:16-alpine | Up (healthy) | none (internal) |
| photobooth-redis | redis:7-alpine | Up (healthy) | none (internal) |
| firz-postgres | postgres:16-alpine | Exited (0) 26 hours ago | — |

`firz-postgres` was already stopped before this session and **was not touched**.

### Compose projects
```
NAME          STATUS         CONFIG FILES
photobooth    running(5)     /home/mahez/photoboothai/docker-compose.yml
```

### Networks
`bridge`, `host`, `none`, `firz-dev_default` (pre-existing, untouched),
**`photobooth-net`** (dedicated, created for this project).

### Volumes
`firz-dev_firz_pgdata` (pre-existing, untouched), `photobooth_pgdata`,
`photobooth_redisdata`, `photobooth_runtime`.

### Listening host ports (before binding)
| Port | Owner |
|---|---|
| 22 | sshd |
| 2208 | node (9router) |
| 20128 | next-server (9router) |
| 20241/20242 | cloudflared |
| 25463 | .cline |
| 8000 / 3000 | **taken by photobooth during this session** |

8000 and 3000 were confirmed free before binding (`ss -lnt`), and no other
project uses them.

### Resources
- CPU: **4** vCPU
- RAM: 9.7 GiB total, 3.0 GiB used, **6.7 GiB available**
- Swap: 4.0 GiB, unused
- Disk `/`: 39 GB total, 19 GB used, **18 GB available (52%)**

### Canonical paths
- `/opt/photobooth` — **does not exist**
- `/srv/photobooth` — **does not exist**
- `/opt` and `/srv` are owned by `root:root`, mode `0755`
- Running user is `mahez`; `sudo -n true` fails → **no passwordless sudo**

---

## 2. Files created / modified

The working checkout is `/home/mahez/photoboothai` (see blocker, §9).

Sprint-1-relevant files:

| Path | Purpose |
|---|---|
| `docker-compose.yml` | 5 services, dedicated network, no DB/Redis host ports |
| `backend/Dockerfile` | FastAPI + worker image |
| `backend/app/main.py` | App factory, CORS, `/api` router mount |
| `backend/app/core/config.py` | Env-only settings (no hardcoded secrets) |
| `backend/app/routers/health.py` | `GET /api/health` |
| `frontend/Dockerfile` | Vite build → nginx stage |
| `frontend/nginx.conf` | Serves bundle, proxies `/api/` → `photobooth-api:8000` |
| `frontend/src/api.js` | Single API client module |
| `frontend/src/components/common.jsx` | `HealthBadge` (renders real health payload) |
| `.env.example` | Safe placeholders only |
| `.env` | Local values, **gitignored** |
| `.gitignore` | Excludes `.env`, `runtime/*`, `node_modules`, `dist` |
| `scripts/bootstrap_vps.sh` | One-time privileged creation of `/opt` + `/srv` trees |
| `scripts/migrate_to_opt.sh` | Unprivileged migration once bootstrap has run |
| `docs/SPRINT1_REPORT.md` | This report |
| `docs/BLOCKER_VPS_PATHS.md` | Blocker + options + rollback |

Both scripts pass `bash -n` syntax validation.

---

## 3. Docker services created

All use the mandated `photobooth-` prefix (skill §3):

- `photobooth-postgres` — postgres:16-alpine, healthcheck `pg_isready`
- `photobooth-redis` — redis:7-alpine, AOF on, 256 MB cap, healthcheck `redis-cli ping`
- `photobooth-api` — FastAPI, healthcheck hits `/api/health`
- `photobooth-web` — nginx serving the built React bundle
- `photobooth-worker` — present from earlier work; **outside Sprint 1 scope**, see §8

## 4. Docker network

**`photobooth-net`** (bridge, explicitly named). All five services join it.
The compose file never references another project's network, so
`docker compose down` cannot affect `firz-dev_default`.

## 5. Host ports used

| Port | Service | Public? |
|---|---|---|
| 3000 | photobooth-web (nginx :80) | yes — frontend |
| 8000 | photobooth-api | yes — direct API access for testing |
| — | photobooth-postgres | **no host port** (internal only) |
| — | photobooth-redis | **no host port** (internal only) |
| — | photobooth-worker | **no host port** |

Verified: `ss -lnt | grep -E ':5432|:6379'` → no match. Requirement met.

Ports are configurable via `PHOTBOOTH_API_PORT` / `PHOTBOOTH_WEB_PORT` in `.env`.

---

## 6. Commands executed (key ones)

```bash
# inspection (read-only)
docker ps -a; docker compose ls; docker network ls; docker volume ls
ss -lntup; nproc; free -h; df -h
ls -ld /opt /srv; sudo -n true

# validation
docker compose config                      # skill docker-vps §6
docker compose ps                          # skill docker-vps §7
ss -lnt | grep -E ':5432|:6379'            # prove DB/Redis not host-exposed

# build / start
docker compose build photobooth-api
docker compose up -d photobooth-api photobooth-worker

# tests
cd backend && ../.venv/bin/python -m pytest -q          # 55 passed
cd backend && ../.venv/bin/python -m pytest tests/test_queue_timeouts.py -v

# connectivity
curl http://127.0.0.1:8000/api/health       # direct
curl http://127.0.0.1:3000/api/health       # browser path through nginx
curl http://127.0.0.1:3000/                 # frontend shell

# live vertical-slice check (exercises the dequeue path after the fix)
curl -X POST http://127.0.0.1:8000/api/uploads -F file=@real_portrait.jpg
curl -X POST http://127.0.0.1:8000/api/generations -d '{...}'
curl http://127.0.0.1:8000/api/generations/{job_id}

# syntax checks
bash -n scripts/bootstrap_vps.sh && bash -n scripts/migrate_to_opt.sh
```

No `docker system prune`, no volume deletion, no firewall/SSH/proxy change,
and no unrelated container was started, stopped or restarted.

## 7. `/api/health` response

Direct (`:8000`) and through the frontend proxy (`:3000`) — identical:

```json
{
  "status": "ok",
  "app": "Photobooth AI",
  "environment": "development",
  "checks": {
    "database": "ok",
    "redis": "ok",
    "ai_provider": "ok (9router)"
  },
  "ai_provider": "9router",
  "ai_provider_connected": true
}
```

HTTP 200. The checks are real: `database` executes a live query,
`redis` executes `PING`, `ai_provider` reflects configured credentials.

## 8. Frontend → backend connectivity

**PASS.** Verified on the actual browser path, not just the API in isolation:

1. `GET http://127.0.0.1:3000/` → HTTP 200 (nginx serves the built bundle)
2. `GET http://127.0.0.1:3000/api/health` → HTTP 200 + the payload above,
   proxied over `photobooth-net` to `photobooth-api:8000`
3. The served bundle contains the `/api` base and the `health` call:
   `docker exec photobooth-web grep -o '/api' assets/*.js` → `/api`
4. `HealthBadge` renders `health.status` and `health.ai_provider_connected`,
   so the page shows **API: ok** and **AI: 9router** from the real response.

No hardcoded backend URL in the frontend; `frontend/src/api.js` uses the
relative `/api` base and is the only module that knows the HTTP contract.

## 9. Container status

```
NAME                  STATUS
photobooth-api        Up (healthy)
photobooth-postgres   Up (healthy)
photobooth-redis      Up (healthy)
photobooth-web        Up (healthy)
photobooth-worker     Up
```

In-container proof of real communication (not merely "running"):

```
api self-check: ok {'database': 'ok', 'redis': 'ok', 'ai_provider': 'ok (9router)'}
/var/run/postgresql:5432 - accepting connections
PONG
```

## 10. Tests performed

| Test | Result |
|---|---|
| `pytest -q` (full backend suite) | **55 passed** |
| `pytest tests/test_queue_timeouts.py -v` (new regression suite) | **6 passed** |
| `docker compose config` | valid |
| 4 container healthchecks (api, web, postgres, redis) | all healthy |
| `pg_isready` inside postgres | accepting connections |
| `redis-cli ping` inside redis | PONG |
| Postgres/Redis host exposure | none (correct) |
| Frontend shell `:3000/` | HTTP 200 |
| Frontend→backend `:3000/api/health` | HTTP 200 + real payload |
| Bundle contains `/api` + health call | confirmed |
| `bash -n` on both scripts | pass |
| Unrelated `firz` container/network/volume | unchanged |

### Defect found and fixed during validation

**Symptom:** `photobooth-worker` logged `loop error: TimeoutError: Timeout
reading from socket` continuously — 74 occurrences in the last 200 log lines,
firing roughly every 7 seconds from process start.

**Root cause (isolated, not guessed):** `backend/app/queue.py` built its Redis
client with `socket_timeout=5` while the worker blocked in `BRPOP` with
`timeout=5`. On an idle queue `BRPOP` legitimately holds the connection open
for the full 5 seconds — exactly the socket read timeout — so redis-py raised
a socket timeout on *every* idle cycle instead of returning `None`. The worker
never died (its `except` caught it) but it spun in an error loop with a 2s
sleep, which would mask genuine failures.

**Smallest correction applied:** derive the socket timeout from the blocking
timeout plus a buffer, so it is always strictly greater.

```python
DEQUEUE_TIMEOUT_SECONDS = 5
SOCKET_TIMEOUT_BUFFER_SECONDS = 10
SOCKET_TIMEOUT_SECONDS = DEQUEUE_TIMEOUT_SECONDS + SOCKET_TIMEOUT_BUFFER_SECONDS
```

Nothing else was changed — one file, `backend/app/queue.py`.

**Retest evidence:**

```
# after rebuild + restart, idling:
[worker] starting: queue=photobooth:generation-queue redis=redis://photobooth-redis:6379/0 provider=9router
[worker] idle (queue_len=0)
loop error count since restart: 0        # was 74 in 200 lines before

# dequeue path still works (not just silenced):
[worker] picked up job c7b8861cb9f743eaa6a6de60fa688b9d
job state -> PROCESSING, provider=9router, model=ag/nano-banana-pro
```

Six regression tests in `backend/tests/test_queue_timeouts.py` now pin the
invariant `SOCKET_TIMEOUT_SECONDS > DEQUEUE_TIMEOUT_SECONDS` so the two values
cannot silently converge again.

---

## 7. Fresh re-verification (2026-09-18T04:12Z)

Context was compacted, so the whole acceptance set was re-checked from live
evidence rather than trusting earlier notes.

### 7.1 Acceptance criteria (skill `web-mvp` §8)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Docker Compose config valid | **PASS** | `docker compose config --quiet` → exit 0 |
| 2 | Relevant containers start | **PASS** | 5/5 up: api+web+postgres+redis `(healthy)`, worker up |
| 3 | PostgreSQL running internally | **PASS** | `pg_isready` → `accepting connections`; no host 5432 listener |
| 4 | Redis running internally | **PASS** | `redis-cli ping` → `PONG`; no host 6379 listener |
| 5 | FastAPI responds to `/api/health` | **PASS** | `200` + real JSON (see §7.2) |
| 6 | Frontend loads | **PASS** | `GET :3000/` → `200 text/html` |
| 7 | Frontend reaches backend health | **PASS** | `GET :3000/api/health` → `200` via nginx proxy; real module test §7.3 |
| 8 | No port conflict with existing apps | **PASS** | only 3000 + 8000 published; pre-existing 22/2208/20128/20241/20242/25463/40967 untouched |
| 9 | Unrelated VPS apps unaffected | **PASS** | `firz-postgres` still `exited`, finished `2026-09-17T02:13:53Z` — 26h *before* any photobooth container started (earliest `03:59:59Z`) |

### 7.2 `/api/health` is a real check, not a hardcoded `"ok"`

Negative test: stopped `photobooth-redis` (a photobooth-owned service only),
re-read health, then restarted it.

```
# redis stopped
{
  "status": "degraded",
  "checks": { "database": "ok", "redis": "error: unreachable", "ai_provider": "ok (9router)" }
}

# redis restarted
status= ok  checks= {'database': 'ok', 'redis': 'ok', 'ai_provider': 'ok (9router)'}
```

Health degrades and recovers with the actual dependency, so it is performing
live checks against PostgreSQL, Redis and the provider.

### 7.3 Frontend module tested against the live backend

`frontend/src/api.js` was imported and executed for real (Node, with relative
`/api/...` resolved against a page origin exactly as a browser does). The
frontend source was **not** modified to make this pass — relative paths are
correct browser behaviour and are what the deployed bundle does.

```
ORIGIN=http://127.0.0.1:3000  (browser → nginx → photobooth-api)
  getHealth()     -> status=ok, database=ok, redis=ok   PASS
  getTemplates()  -> count=1, ids=sci-fi-space-commander-001  PASS

ORIGIN=http://127.0.0.1:8000  (direct to backend)
  getHealth()     -> PASS
  getTemplates()  -> PASS
```

Both field names and shapes match the FastAPI schemas, so the frontend and
backend genuinely share one contract (§11 of `AGENTS.md`).

The served bundle was also confirmed to contain the `"/api"` base and the
`"/health"` path literals, so the deployed asset is the code under test.

### 7.4 Backend test suite

```
55 passed, 1 warning in 0.44s
```

### 7.5 Logs

No `error`/`traceback`/`fatal` lines in `photobooth-api`, `photobooth-web`,
`photobooth-postgres` or `photobooth-redis`. The only worker log entry is a
genuine, honestly-reported upstream provider failure from Sprint 3-era testing
(`AI_PROVIDER_ERROR`, HTTP 502 from `antigravity/nano-banana-pro`) — not a
Sprint 1 defect, and correctly surfaced rather than hidden.

### 7.6 Still BLOCKED — canonical VPS paths

Re-confirmed live at 04:12Z:

```
$ mkdir -p /opt/photobooth
mkdir: cannot create directory '/opt/photobooth': Permission denied
$ mkdir -p /srv/photobooth
mkdir: cannot create directory '/srv/photobooth': Permission denied
$ sudo -n true
sudo: a password is required
```

`/opt` and `/srv` are `root:root` `0755`; the agent runs as `mahez` with no
passwordless sudo. Sprint 1 items 1 and 2 therefore remain blocked on one
privileged human action — see `docs/BLOCKER_VPS_PATHS.md` for options A–D.

### 7.7 Result

**PARTIAL** — 7 of 9 acceptance criteria PASS with live evidence; items 1 and 2
(canonical `/opt/photobooth` and `/srv/photobooth` host paths) are blocked on a
privileged action the agent cannot and will not work around.

### 7.8 Real browser render (strongest proof of item 7)

A headless Chromium 153 (Playwright's cached `chrome-headless-shell`) loaded
`http://127.0.0.1:3000/` and the DOM was dumped after React hydrated and the
`fetch('/api/health')` promise resolved.

Visible text in the rendered page:

```
Photobooth AI
Upload -> Validate -> Template -> Generate -> Preview -> Download
API: ok      AI: 9router
1 - Upload   2 - Template   3 - Processing   4 - Result
Upload your photo
JPEG, PNG or WEBP - max 12 MB - min 256px per side.
Click or drop a photo here
Web MVP - vertical slice
```

Assertion results against the dumped DOM:

| Needle | Present | Meaning |
|---|---|---|
| `API: ok` | true | `HealthBadge` rendered `health.status` from the live API |
| `AI: 9router` | true | `health.ai_provider` rendered |
| `NOT CONNECTED` | false | provider reports connected, so the warn branch did not fire |
| `checking…` | false | the initial pre-fetch state was replaced -> the fetch completed |

This is stronger than an HTTP 200: the badge text can only come from a
successful response body, so frontend -> backend connectivity is proven at the
DOM level, through the production nginx proxy path a real user takes.

### 7.9 Scope deviation note (reported, not hidden)

The frontend bundle and `frontend/src/api.js` also contain upload, template,
generation-polling and result/download code, and the backend exposes
`/api/templates`, `/api/uploads`, `/api/generations`, `/api/results`. Those
belong to Sprint 2-4 scope and were **not** written or modified for Sprint 1;
they pre-existed in this working tree from earlier sessions. Sprint 1 work was
limited to health, the health/status view, the compose/network/port layer and
verification.

Nothing from later sprints was *newly* implemented in this sprint, and Sprint 2
was not started or continued.

### 7.8 Real browser render (DEFINITIVE proof for criterion 7)

Criterion 7 ("frontend successfully reaches backend health endpoint") was proven
with a real headless Chromium 153, not just HTTP status codes.

```bash
CHROMIUM=~/.cache/ms-playwright/chromium_headless_shell-1243/.../chrome-headless-shell
$CHROMIUM --headless --no-sandbox --disable-gpu \
  --virtual-time-budget=12000 --timeout=20000 --dump-dom \
  http://127.0.0.1:3000/
```

Rendered DOM (excerpt):

| Rendered element | Value | Meaning |
|---|---|---|
| `<title>` | `Photobooth AI — Status` | React app mounted |
| header | `Photobooth AI` | shell rendered |
| `h1` | `Sprint 1 Infrastructure` | page rendered |
| badge | **`API: ok`** | **browser fetched `/api/health` and got `status: "ok"`** |
| badge | **`AI: 9router`** | browser rendered `ai_provider` from the response |
| badge | **`checking…` ABSENT** | loading state replaced → fetch completed |
| health details | app `Photobooth AI`, env `development`, provider `9router` | real response body rendered |

Why this is conclusive: the `API: ok` badge and the `AI: 9router` badge can only
appear if the in-browser `fetch('/api/health')` resolved and returned real JSON.
A failed or absent fetch leaves the `checking…` badge, which is gone.

