from worker.healthcheck import _process_state, is_worker_process


def test_healthcheck_accepts_running_worker_main_pid1():
    cmdline = b"/usr/local/bin/python\0-m\0worker.main\0"
    assert is_worker_process(cmdline, "S")


def test_healthcheck_rejects_non_worker_or_wrong_interpreter():
    assert not is_worker_process(b"/bin/sh\0-c\0sleep infinity\0", "S")
    assert not is_worker_process(b"python\0-m\0uvicorn\0", "S")


def test_healthcheck_rejects_zombie_worker():
    assert not is_worker_process(b"python\0-m\0worker.main\0", "Z")


def test_process_state_parses_parenthesized_command():
    assert _process_state("1 (python worker) S 0 0 0") == "S"
