# Desktop 1.1.1 automatic activity diagnostics

Based on desktop-v1.1.0 (d7dca76). No backend, database, gateway or container change is required. Existing event mode, update progress and Canon USB sessions are preserved.

The signed-in app automatically sends activity batches to the existing authenticated `POST /api/v1/desktop/diagnostics`. Staff do not need to run the Canon probe or press Send log. Startup and actions before login are queued locally. Delivery runs every 15 seconds, with a 12-second minimum send interval and exponential retry from 15 to 120 seconds. Normal bursts can take multiple batches to drain. Upload failure does not block capture or generation.

## Recorded operations

- Every desktop IPC action: begin, outcome, duration and short error code. Parameters and return values are excluded. UI clicks/changes contain only the control tag, never its label or value.
- Native adapter requests, process exit and timeout.
- Canon enumeration count, connect, session open, event polling, live-view start/stop, frame result code and byte count, shutter, JPEG transfer, saved result and close. Exceptions contain only their type, HRESULT and a short code. No exception message, device identifier, file path or image bytes is recorded.
- Renderer preview ready/empty/error, image decode failure and reconnect, plus global renderer errors and process loss.
- Network operation category, HTTP outcome and duration; no URL, query, ID, header, cookie, body or credential. Diagnostics uploads are excluded from their own trace to prevent a feedback loop.
- Session state transitions and photo count. Existing manual support reports still include the last probe and startup error tail.

Repeated polling (`state`, thumbnails, preview frames, generation/login polling) records the first result and new error/result codes, then summarizes identical outcomes once per minute. It does not store every successful frame. Scalar fields are allowlisted at the logger boundary; native output and renderer input pass through that boundary as well.

## Storage and compatibility

The existing report schema is unchanged: `note` starts with `activity/v1 boot=<id> batch=<n> dropped=<n>` and `startup_log` contains <= 1900 characters of newline-delimited activity JSON. This field is a compatibility transport for the activity batch, not a claim that the error occurred at startup. The server stores it in `/srv/photobooth/desktop-diagnostics/YYYY-MM-DD.jsonl` with the existing account, machine and app version metadata.

Event keys: `t` timestamp, `a` action, `s` status, `c` code, `ms` duration, `bytes` size, `count` aggregate count, `http` HTTP status, `sdk` SDK result, `ex` exception type and `hr` HRESULT. Decode each line of `report.startup_log` only when `report.note` starts with `activity/v1`.

Local files under Electron userData: `activity.jsonl` plus `activity.previous.jsonl` (rotation around 512 KiB each), and `activity-queue.json` (<= 512 queued events, persisted atomically). When the queue fills, the oldest events are dropped and the cumulative count is included in the batch note. Automatic sending has a conservative 1.5 MB/day budget per PC to leave room under the existing shared 2 MB/day server cap. Budget exhaustion, server rejection or network failure leaves the bounded local log available; delivery resumes after backoff/day reset. The state API exposes queued/dropped counts, last delivered timestamp and logging error. No new endpoint or server budget increase is part of this release.

The frame RPC deadline is now 35 seconds, covering native live-view restart (up to 15 s) plus frame read (up to 10 s), so a native operation is not cut off by the previous 15 s bridge deadline. Shutter retries remain manual.

## Verification

Unit tests cover allowlisting, offline persistence/restart, retry/cooldown, retaining actions that arrive during upload, repeated-frame aggregation, safe stderr ingestion and background delivery. Electron testing exercises the real preload/IPC and automatic HTTP sending without staff interaction. SDK UI tests assert preview error telemetry. Physical Windows camera acceptance remains pending; 1.1.1 supplies the missing evidence to investigate the kiosk's preview failure.
