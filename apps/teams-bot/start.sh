#!/bin/sh
set -e

# Start the Teams bot
exec node apps/teams-bot/dist/index.js
