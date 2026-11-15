# patrickscheid.de as a container for the k3s cluster (pscheid92/k8s,
# apps/website): Astro builds the static files, nginx serves them.

# The build stage runs on the builder's own platform: its output is static
# files, the same for every target.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# nginx as an unprivileged user (101), listening on 8080. The site gets a
# directory of its own: the image's html directory holds nginx's sample pages.
FROM nginxinc/nginx-unprivileged:stable-alpine-slim
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /srv/www
EXPOSE 8080
