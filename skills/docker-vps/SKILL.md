---
name: docker-vps
description: Perform isolated Docker and VPS operations for Photobooth AI while protecting co-hosted applications and shared infrastructure.
---

# Docker VPS Operations

Use this skill for Docker or VPS-level work. Photobooth is isolated from other applications.

Before any Docker change, inspect `docker ps`, `docker compose ls`, `docker network ls`, `docker volume ls`, `ss -lntup`, `free -h`, `df -h`, and `nproc` as relevant. Confirm `/opt/photobooth` and `/srv/photobooth` are the only project paths involved.

Use `photobooth-` container names and a dedicated `photobooth-network`. Keep PostgreSQL (`5432`) and Redis (`6379`) internal. Check host ports before binding them. Run `docker compose config` before `docker compose up`; after startup inspect `docker compose ps`, recent logs, and the real application health endpoint.

Never run `docker system prune`, remove unknown resources, restart the Docker daemon, reboot the VPS, or alter UFW, SSH, global reverse proxy, or another project's Compose configuration. If a shared infrastructure change is required, report the change, reason, impact, and rollback method, then stop.

Report containers, networks, volumes, ports, health, errors, resource observations, and `PASS` / `PARTIAL` / `FAIL`.
