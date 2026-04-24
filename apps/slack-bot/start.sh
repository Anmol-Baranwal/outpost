#!/bin/sh
set -e

# Start the Slack bot
exec node apps/slack-bot/dist/index.js
