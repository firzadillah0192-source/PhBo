# ---------------------------------------------------------------------------
# Photobooth AI — frontend image (photobooth-web)
#
# Multi-stage: build the React/Vite bundle with Node, then serve the static
# output from nginx. nginx also reverse-proxies /api to photobooth-api over the
# dedicated photobooth-net network, so the browser only ever talks to one origin.
#
# This nginx runs INSIDE the photobooth-web container only. It does not touch
# any global/host reverse proxy configuration (spec section 7).
# ---------------------------------------------------------------------------

# --- Stage 1: build ---------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies first so this layer caches when only source changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

# --- Stage 2: serve ---------------------------------------------------------
FROM nginx:1.27-alpine

# Remove the stock site so ours is the only one served.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/photobooth.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
