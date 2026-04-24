#!/bin/sh
set -e

# Start the Linear sync service
exec node apps/linear-sync/dist/index.js
