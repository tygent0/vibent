FROM node:22-alpine
WORKDIR /app
RUN npm i -g pnpm
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @vibent/shared build
RUN pnpm --filter @vibent/api build
EXPOSE 8080
CMD ["pnpm", "--filter", "@vibent/api", "start"]
