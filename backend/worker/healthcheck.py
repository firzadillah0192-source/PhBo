"""Read-only Docker liveness check for the generation worker PID 1."""

from __future__ import annotations

from pathlib import Path


def is_worker_process(cmdline: bytes, state: str) -> bool:
    """Return true only for a live Python process running ``worker.main``."""
    if state in {"Z", "X", "x"}:
        return False

    args = [part.decode("utf-8", "replace") for part in cmdline.split(b"\0") if part]
    if not args or not Path(args[0]).name.startswith("python"):
        return False
    return any(args[index : index + 2] == ["-m", "worker.main"] for index in range(len(args) - 1))


def _process_state(stat_line: str) -> str:
    # /proc/<pid>/stat has a parenthesized command field which can contain
    # spaces. The state token follows its final closing parenthesis.
    closing = stat_line.rfind(")")
    if closing < 0:
        return "?"
    fields = stat_line[closing + 1 :].strip().split()
    return fields[0] if fields else "?"


def main() -> int:
    try:
        cmdline = Path("/proc/1/cmdline").read_bytes()
        stat_line = Path("/proc/1/stat").read_text(encoding="ascii")
    except OSError:
        return 1
    return 0 if is_worker_process(cmdline, _process_state(stat_line)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
