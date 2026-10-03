FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm db:generate
COPY src ./src
COPY tsconfig.json tsconfig.build.json ./
RUN pnpm build
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/server.js"]
