# The speech-token service of the spelling trainer (token.ts) for the k3s
# cluster (pscheid92/k8s, apps/website). Node runs the TypeScript as it is,
# so the image is Node and two files: nothing is installed, nothing is built.
#
# Distroless: no shell, no package manager, and it runs as "nonroot" (65532).
FROM gcr.io/distroless/nodejs24-debian13:nonroot
WORKDIR /app
COPY token.ts server.ts ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["/app/server.ts"]
