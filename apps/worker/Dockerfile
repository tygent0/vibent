FROM node:22-alpine
WORKDIR /app
RUN npm i -g pnpm
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @vibent/worker build
EXPOSE 8090
CMD ["pnpm", "--filter", "@vibent/worker", "start"]
