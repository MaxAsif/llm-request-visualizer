#!/bin/sh
set -e

# The tRPC API and the built UI run in the same container so the UI's built-in
# proxy (target http://127.0.0.1:<api port>) works unmodified, same as in local dev.
node /app/apps/viewer/dist/server/main.js &

exec pnpm --filter @llmviz/viewer exec vite preview --host 0.0.0.0 --port 5317
