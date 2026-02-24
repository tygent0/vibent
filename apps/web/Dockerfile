FROM node:22-alpine
WORKDIR /app
RUN npm i -g pnpm
COPY . .
RUN pnpm install --frozen-lockfile=false
ARG NEXT_PUBLIC_VIBENT_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_VIBENT_API_URL=$NEXT_PUBLIC_VIBENT_API_URL
RUN pnpm --filter @vibent/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@vibent/web", "start"]
