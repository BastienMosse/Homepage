FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/data ./data
COPY --from=build /app/package.json ./
RUN npm install --omit=dev 2>/dev/null; exit 0
EXPOSE 3000
CMD ["node", "server/index.cjs"]
