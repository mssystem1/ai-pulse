FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY assets ./assets
COPY tsconfig.base.json ./
RUN npm install --legacy-peer-deps
RUN npm run build -w @pulse/schemas \
 && npm run build -w @pulse/domain \
 && npm run build -w @pulse/config \
 && npm run build -w @pulse/market \
 && npm run build -w @pulse/analysis \
 && npm run build -w @pulse/payments \
 && npm run build -w @pulse/buyer \
 && npm run build -w @pulse/sdk \
 && npm run build -w @pulse/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
