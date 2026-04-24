#!/bin/sh
set -e

# Start the Discord bot
exec node apps/discord-bot/dist/index.js
