@AGENTS.md

## Claude Code notes

- `AGENTS.md` is the single source of truth for project rules and is also read by Codex, which the owner alternates with Claude. Keep this file thin; put anything that should apply to both agents in `AGENTS.md`, including the multi-agent rules there.
- Prefer `Read`/`Grep` over `cat`/`grep` for exploring; ignore `node_modules/`, `dist/`, `testimage/`, `import-assets/`, `experiments/`.
- Never read or echo `.env`. Use `.env.example` for variable names.
- The two odd files in the repo root (`h -u origin main`, `ting Photobooth AI application"`) are stray artifacts from a mistyped git command; leave them unless asked to delete.
- Commit only when asked. Do not push.
