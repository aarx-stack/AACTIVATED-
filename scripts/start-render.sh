#!/bin/sh
# Start command for hosted copies (Render): apply database migrations, load the demo company
# once when SEED_DEMO=true (it skips itself if the database already has data), then serve.
set -e
npx prisma migrate deploy
if [ "$SEED_DEMO" = "true" ]; then
  npx prisma db seed
fi
exec npx next start -p "${PORT:-3000}"
