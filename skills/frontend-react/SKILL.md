---
name: frontend-react
description: Build and validate responsive React/Vite UI for the Photobooth AI image-first Web MVP.
---

# React Frontend

Use React + Vite. Preserve the primary workflow: upload, validate, choose one template, generate, process, preview, and download. Keep the main action obvious and the UI image-first, premium, dark, clean, modern, responsive, and accessible.

Directional routes are `/`, `/create`, `/templates`, `/generate/:jobId`, and `/result/:resultId`; adjust only when needed while preserving a clear linear flow. Upload UX must show a selected image preview, validation state, useful errors, and retry/change controls. Do not proceed silently with invalid images.

Generation is asynchronous. Poll actual backend state for `QUEUED`, `PROCESSING`, `COMPLETED`, and `FAILED`; do not use timers to fake completion. Centralize API access, use the configured API base URL, and match backend contracts exactly. Prefer local state/context; do not add a state library without demonstrated need.

Verify important interactions, API connectivity, loading/error states, responsive behavior, focus states, labels, alt text, and contrast. Report routes, components, API contract, tests, manual validation, and limitations.
