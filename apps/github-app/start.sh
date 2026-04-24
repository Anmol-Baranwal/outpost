#!/bin/sh
set -e

# Start the GitHub app
exec node apps/github-app/dist/index.js
