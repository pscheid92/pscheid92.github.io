FROM alpine:latest as build

RUN apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community hugo

WORKDIR /blog
COPY . .
RUN hugo

FROM caddy:alpine
COPY --from=build /blog/public /usr/share/caddy
