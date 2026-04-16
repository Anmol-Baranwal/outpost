#!/bin/sh
# Start Next.js directly — DB migrations are handled externally via `prisma db push`
exec node apps/web/server.js
