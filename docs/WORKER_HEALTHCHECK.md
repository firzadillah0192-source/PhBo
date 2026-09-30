# Generation worker healthcheck

Docker reports the worker container as `healthy` when PID 1 is a non-zombie
Python process whose arguments include `-m worker.main`. The check reads
`/proc/1/cmdline` and `/proc/1/stat`; it does not connect to Redis or PostgreSQL,
pop a queue item, or create a job.

`unhealthy` means PID 1 is missing, is not the worker module, cannot be
inspected, or is a zombie for three consecutive checks. This status is distinct
from Docker's container state: a container can remain `Up` while its health
status is `unhealthy`.

The check proves that the worker process is running. It does not prove that
Redis is reachable or that a generation job will succeed; those are checked by
the worker's normal queue loop and job results.
