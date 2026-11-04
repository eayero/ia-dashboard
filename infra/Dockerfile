FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl && npm install --global pnpm@12.16.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
RUN --mount=type=cache,id=acc-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY . .
RUN pnpm build

FROM node:24-alpine AS api
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 53000
CMD ["node", "apps/api/dist/main.js"]

FROM nginx:1.30.6-alpine AS ui
COPY infra/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
