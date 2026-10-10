---
name: frontend-react
description: Build and validate responsive React/Vite UI for the Photobooth AI image-first Web MVP.
---

# React Frontend

Use React + Vite (`frontend/`, tests via `npm test`, build via `npm run build`). The app has three modes (Classic, Basic, Advanced), kiosk and customer flows; preserve the existing linear flow of each: input photo(s), validate, choose, generate, process, preview, download/claim. Keep the main action obvious and the UI image-first, premium, dark, clean, modern, responsive, and accessible.

Follow the existing routing in `src/customerRoute.js` and `src/App.jsx`; do not rename routes casually. Upload UX must show a selected image preview, validation state, useful errors, and retry/change controls. Do not proceed silently with invalid images.

Generation is asynchronous. Poll actual backend state for `QUEUED`, `PROCESSING`, `COMPLETED`, and `FAILED`; do not use timers to fake completion. Centralize API access, use the configured API base URL, and match backend contracts exactly. Prefer local state/context; do not add a state library without demonstrated need.

Verify important interactions, API connectivity, loading/error states, responsive behavior, focus states, labels, alt text, and contrast. Report routes, components, API contract, tests, manual validation, and limitations.
