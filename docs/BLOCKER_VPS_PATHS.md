# BLOCKER — canonical VPS paths require one privileged action

**Status:** BLOCKED, needs a human decision/action
**Raised:** 2026-09-18
**Affects:** Sprint 1 items 1 and 2 only. All other Sprint 1 items are complete.

---

## 1. What must change

`skills/docker-vps/SKILL.md` §2 fixes the project boundary:

```
application files : /opt/photobooth
runtime files     : /srv/photobooth
```

Neither directory exists, and neither can be created by the agent.

## 2. Evidence

```
$ ls -la /opt/photobooth
ls: cannot access '/opt/photobooth': No such file or directory

$ ls -la /srv/photobooth
ls: cannot access '/srv/photobooth': No such file or directory

$ mkdir -p /opt/photobooth
mkdir: cannot create directory '/opt/photobooth': Permission denied

$ mkdir -p /srv/photobooth
mkdir: cannot create directory '/srv/photobooth': Permission denied

$ ls -ld /opt /srv
drwxr-xr-x 3 root root 4096 Agu 29 02:07 /opt
drwxr-xr-x 2 root root 4096 Feb 10  2026 /srv

$ id
uid=1000(mahez) gid=1000(mahez) ...

$ sudo -n true
sudo: a password is required
```

Both parents are `root:root` mode `0755`. The agent runs as `mahez` with no
passwordless sudo. Creating these trees therefore needs exactly one privileged
invocation that only a human operator can perform.

Per `AGENTS.md` §7 and skill §9, the agent must **stop and report** before any
change to shared VPS infrastructure rather than working around it.

## 3. Why it was not worked around

Three workarounds were considered and rejected:

| Option | Why rejected |
|---|---|
| Put the app in `/home/mahez/photoboothai` permanently | Violates the documented boundary; runtime data would live in a home dir with no backup story |
| Bind-mount a home-dir runtime into the container at `/srv/photobooth` | Container path would be correct but the host path would still violate the boundary, and the deception would be invisible in `docker inspect` |
| Ask for the sudo password | Never appropriate; secrets must not transit the agent |

The containers currently satisfy the *internal* contract (`RUNTIME_DIR=/srv/photobooth`
inside the container, backed by the named volume `photobooth_runtime`), so the
application is fully functional. Only the **host-side** canonical layout is missing.

## 4. Options for the product owner

### Option A — run the prepared bootstrap script (recommended)
One command, as a human with sudo:

```bash
sudo bash /home/mahez/photoboothai/scripts/bootstrap_vps.sh
```

Then, unprivileged:

```bash
bash /home/mahez/photoboothai/scripts/migrate_to_opt.sh
```

- **Impact:** creates `/opt/photobooth` and `/srv/photobooth/{templates,tmp,cache,backups,uploads,results}`, chowned to `mahez`. Touches no other path.
- **Rollback:** `sudo rm -rf /opt/photobooth /srv/photobooth` (safe while no production data exists).
- Both scripts are idempotent, never delete anything, and never run `docker system prune`.

### Option B — grant the deploy user the two directories once
```bash
sudo mkdir -p /opt/photobooth /srv/photobooth
sudo chown -R mahez:mahez /opt/photobooth /srv/photobooth
```
Same effect, no script. Rollback identical.

### Option C — accept the current location
Keep the app at `/home/mahez/photoboothai` with the `photobooth_runtime` named
volume, and amend `AGENTS.md`/skill §2 to record the deviation.

- **Impact:** no privileged action ever needed; but the documented boundary
  stays violated, and future operators reading the skill will be misled unless
  the docs are updated.
- **Rollback:** none needed.

### Option D — passwordless sudo scoped to these two paths
Add a sudoers drop-in allowing only `mkdir`/`chown` on `/opt/photobooth` and
`/srv/photobooth`. Most flexible, but it is a **shared-infrastructure security
change** and needs explicit approval; not recommended for an MVP.

**Recommendation: Option A.** Smallest, most auditable, reversible, and it
matches the documented boundary exactly.

## 5. What is NOT blocked

Everything else in Sprint 1 works today from `/home/mahez/photoboothai`:

- `docker compose config` → valid
- all five containers up and healthy
- `GET /api/health` → 200 with real dependency checks
- frontend → backend connectivity through nginx → verified
- Postgres/Redis not host-exposed → verified
- unrelated applications untouched → verified

So the stack can be used and developed against immediately; the path migration
is a relocation step, not a prerequisite for function.

## 6. Decision needed

Choose A, B, C or D. Until then Sprint 1 stays **PARTIAL** and no attempt will
be made to create `/opt/photobooth` or `/srv/photobooth`.
