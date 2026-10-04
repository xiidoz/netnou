FROM node:26-alpine

LABEL org.opencontainers.image.title="Netnou" \
      org.opencontainers.image.description="Live public-transport map computed from GTFS, GTFS-Realtime and OpenStreetMap data" \
      org.opencontainers.image.source="https://github.com/xiidoz/netnou" \
      org.opencontainers.image.licenses="MIT"

# No "npm ci": the server has no dependencies. package.json is needed all the
# same: its "type": "module" makes the .js files ES modules, and the server
# reports the version from it. The licence travels with every copy of the code.
WORKDIR /app
COPY package.json LICENSE ./
COPY server ./server
COPY public ./public

# The caches live in a volume. Its mount point is created here, owned by the
# unprivileged user: Docker gives a new, empty volume the ownership of the
# directory it is mounted over, which is what makes it writable.
RUN mkdir /data && chown node:node /data
VOLUME /data

ENV DATA_DIR=/data PORT=8080
EXPOSE 8080
USER node

# Uses node itself, so the image needs neither wget nor curl. /api/status does
# not count as a visitor, so this does not start the realtime polling.
HEALTHCHECK --interval=1m --timeout=5s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/status').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# node runs as PID 1 and handles SIGTERM itself (server/index.js); it starts no
# child processes, so no init process (tini) is needed. Not "npm start": npm
# would not pass the signal on and wants a writable home directory.
CMD ["node", "server/index.js"]
