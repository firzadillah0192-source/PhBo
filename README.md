# NXBooth — three standalone apps

| App | Folder | Dev port | Routes |
|---|---|---|---|
| Admin console | `admin/` | 5173 | `/overview`, `/generations`, `/users`, `/login`, … |
| Customer web | `customer/` | 5174 | `/app/*`, `/r/:token`, `/claim/:code`, `/design-system`, `/screens` |
| Web kiosk | `kiosk/` | 5175 | `/kiosk` (`?step=attract|mode|camera|style|processing|result|idle|signin`) |

Each folder is independent: its own `package.json`, build and deploy bundle.

```
cd admin   && npm install && npm run dev      # or: npm run build
cd customer && npm install && npm run dev
cd kiosk   && npm install && npm run dev
```

On Windows PowerShell use `npm.cmd` if script execution is disabled.
Production: serve each `dist/` as a single-page app (all paths fall back to `index.html`).

`ui.tsx`, `overlays.tsx`, `index.css` and `tailwind.config.js` are copied into every app (same design tokens).
Change a token in one place and mirror it in the others.
