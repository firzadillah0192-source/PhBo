# Basic face-detection robustness audit

This is an isolated, CPU-only audit. The follow-up face-count reconciliation
changes validation only; it does not alter identity transfer, Basic geometry,
the compositor, or any deployed service. The controlled matrix uses only
non-customer sources:

- `templates/_preview_sources/portrait-default.png` (tracked preview asset)
- `templates/sci-fi-space-commander-001/template.png` (approved template)
- Matplotlib 3.9.4's bundled `sample_data/grace_hopper.jpg` (local sample)

Yaw and pitch cases are explicitly labelled as mild 2D projective proxies;
they are not substitutes for real photographs at those head poses. No
customer image is included in the fixture set, debug sheet, or matrix output.

Run `run_detection_matrix.py` in the worker image, passing paths to those three
assets. It uses the worker's installed OpenCV and MediaPipe packages and writes
only generated test fixtures plus aggregate detections to the requested output
directory. `replay_candidate_matrix.py` then runs the isolated candidate source
against those fixtures through both the face-count and existing landmark gates.
`trace_recent_failures.py` records current-runtime detector counts, while
`replay_recent_failed_jobs.py` replays those failures with the candidate source.
Both job scripts process images in memory and never save image bytes or print
storage paths. Their outputs contain opaque job/upload IDs because the audit
explicitly requests them; keep those traces local and do not commit them.

The Basic path requires exactly one usable face. OpenCV Haar remains the fast
first pass. If Haar returns zero or multiple boxes, the existing MediaPipe Face
Mesh detector now resolves that disagreement; zero or multiple MediaPipe faces
still fail. When Haar returns exactly one box, the downstream Face Mesh pass
continues as before. The matrix retains raw Haar counts and separately records
the reconciled face-count decision.
