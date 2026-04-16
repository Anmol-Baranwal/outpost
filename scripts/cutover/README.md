# Orca → Outpost Cutover

Step-by-step procedure for switching from Orca (app.getorca.ai) to Outpost as the primary support bot.

## Pre-Cutover Checklist

Before starting the parallel run, verify:

- [ ] **Database migrated** — `npx tsx scripts/migrate-from-orca.ts` completed successfully
- [ ] **Environment variables set** on Railway for all services:
  - `DATABASE_URL`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `GUILD_ID`
  - `MONITORED_CHANNEL_IDS` (comma-separated forum channel IDs)
  - `ANTHROPIC_API_KEY` (for AI responses)
  - `SHADOW_MODE=true` (critical — prevents double-posting)
- [ ] **Railway services deployed** — `outpost-web`, `outpost-discord-bot`, `outpost-github-app`
- [ ] **Discord bot connected** — bot is online in the server with correct permissions
- [ ] **GitHub app installed** — if using GitHub integration for issue tracking
- [ ] **Pathfinder indexed** — knowledge base is populated and responding
- [ ] **HubSpot synced** — customer account data is flowing (if applicable)

## Phase 1: Parallel Run (Shadow Mode)

Shadow mode lets Outpost monitor the same channels as Orca without posting responses.

### Enable Shadow Mode

1. Set `SHADOW_MODE=true` in the discord-bot's environment variables on Railway
2. Deploy the discord-bot service
3. Verify the bot is online: check the `/health` endpoint and Discord presence

### What Happens in Shadow Mode

- Outpost monitors threads in configured channels
- Creates tickets in the Outpost database
- Generates AI responses but does **NOT** post them to Discord
- Logs shadow responses for quality comparison with Orca's actual responses
- Orca continues to operate normally — users see no change

### Monitor the Parallel Run

Run the quality validation script periodically:

```bash
npx tsx scripts/cutover/validate-quality.ts
npx tsx scripts/cutover/validate-quality.ts --since 2024-01-15  # filter by date
```

The script compares:
- **Response time**: Outpost vs Orca response latency
- **Content quality**: response length, code blocks, links
- **Confidence distribution**: percentage of high/medium/low confidence responses

Target: run for **48-72 hours** with at least 20 shadow responses before proceeding.

## Phase 2: Validation

### Quality Criteria

The cutover script checks these targets automatically:

| Metric | Target |
|--------|--------|
| Shadow responses collected | >= 20 |
| Average response time | < 10 minutes |
| Response length vs Orca | >= 50% of Orca average |
| Low confidence rate | < 20% |

### Run Validation

```bash
npx tsx scripts/cutover/validate-quality.ts --min-sample 20
```

Produces a report with a recommendation: `READY`, `NOT_READY`, or `NEEDS_MORE_DATA`.

## Phase 3: Cutover

### Dry Run First

```bash
npx tsx scripts/cutover/execute-cutover.ts
```

This validates all prerequisites without making changes.

### Execute Cutover

```bash
npx tsx scripts/cutover/execute-cutover.ts --confirm
```

The script:
1. Verifies all health checks pass
2. Validates shadow mode quality metrics
3. Disables shadow mode (`SHADOW_MODE=false`)
4. Posts upgrade announcement in support channels

### Post-Cutover

- [ ] Verify Outpost is responding to new threads within 5 minutes
- [ ] Disable Orca bot in Discord server settings
- [ ] Monitor for 2 hours — check response quality and timing
- [ ] Verify no threads are being missed (compare channel activity vs ticket count)

## Phase 4: Rollback (if needed)

If issues arise after cutover, roll back immediately:

### Dry Run

```bash
npx tsx scripts/cutover/rollback.ts
```

### Execute Rollback

```bash
npx tsx scripts/cutover/rollback.ts --confirm --reason "Response quality degradation"
```

The rollback script:
1. Verifies database integrity (ticket data is preserved)
2. Re-enables shadow mode (`SHADOW_MODE=true`)
3. Logs the rollback event for audit trail
4. Prints manual steps: re-enable Orca bot, verify it's responding

### Manual Steps After Rollback

1. Re-enable Orca bot in Discord server settings
2. Verify Orca is responding to new threads
3. Monitor for 30 minutes to confirm stability
4. Investigate the root cause before attempting cutover again
