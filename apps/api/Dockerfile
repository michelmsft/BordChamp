FROM node:22-bookworm-slim AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY packages/authz/package.json packages/authz/tsconfig.json ./packages/authz/
COPY packages/domain/package.json packages/domain/tsconfig.json ./packages/domain/
RUN pnpm install --frozen-lockfile

COPY apps/api ./apps/api
COPY packages/authz ./packages/authz
COPY packages/domain ./packages/domain
RUN pnpm --filter @bordchamp/api... build
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=build /workspace/package.json /workspace/pnpm-workspace.yaml ./
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/packages ./packages

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]