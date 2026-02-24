FROM node:22-alpine
WORKDIR /app
RUN npm i -g pnpm
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @vibent/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@vibent/web", "start"]
