# Staging + Production Deployment Model — Design

**Date:** 2026-07-24
**Status:** Approved (branches + shadow-mode safety); branch protection deferred
**Owner:** Nathan

## Goal

Run a proper staging environment as the testing branch, keep the model simple and
fast, and make it safe to test the auto-responding agent in staging without it
replying to real users in production communities.

## Deployment model (keep — it is already the simple one)

Two Railway environments in the `outpost` project, each with its **own** Postgres
(verified isolated — different DB credentials, staging never touches prod data).

```
merge PR → main → auto-deploys STAGING → test
promote:  git push origin main:production → auto-deploys PRODUCTION
```

| | staging | production |
| --- | --- | --- |
| Deploys from | `main` (CI-gated) | `production` branch (CI-gated) |
| Web URL | outpost-web-staging.up.railway.app | outpost.copilotkit.ai |
| Database | own Postgres | own Postgres |
| Triggered services | web, github-app, discord-bot, worker | same 4 |
| `SHADOW_MODE` (worker) | **true** | false |

Other three services (slack-bot, teams-bot, linear-sync) are optional integrations,
left offline until their credentials are configured.

No release tags, no promote pipeline for now. Promotion stays `git push
origin main:production` — fast, one command, from tested commits.

## The auto-responder problem and its fix

The agent auto-responds across Discord/GitHub/Slack/Teams. Staging was forked from
production, so it inherited production's platform config (same Discord guild). Left
unguarded, staging would post a *second* AI response to the real communities.

**Architecture fact:** every auto-response posts through a single choke point —
`packages/outpost/queue/src/handlers/ai-response.ts:218` (`adapter.postResponse`),
which runs only in the **worker** service (`apps/worker/src/index.ts:70`,
`JobType.AI_RESPONSE`). Immediately before it, `SHADOW_MODE === 'true'`
(ai-response.ts:178) short-circuits: the full pipeline still runs and the response
is persisted as a shadow `Message` row (with confidence + latency), but nothing is
posted to any platform. One flag, all surfaces.

The bot services (discord-bot etc.) only *enqueue* jobs; they do not post AI
responses. Escalation notifications write DB rows only — no external post. So
`SHADOW_MODE` on the worker covers every auto-response to a user.

**Second outbound path — `ONBOARDING_DIGEST` (now gated).** That scheduled job (every
24h, `packages/outpost/queue/src/handlers/onboarding-digest.ts`) posts a digest
directly to Discord over raw REST using `DISCORD_DIGEST_CHANNEL_ID`, bypassing the
platform adapters. It originally ignored `SHADOW_MODE`, so a staging worker with that
channel set would have posted to a real Discord channel (inert in practice only
because the variable is unset in both environments). It now checks `SHADOW_MODE` and
logs the digest instead of posting, covered by tests in
`packages/outpost/queue/src/__tests__/onboarding-digest.test.ts`.

Note also that `postAiResponse` helpers exist in `apps/slack-bot`, `apps/teams-bot`,
and `apps/github-app` but have no non-test callers — the live path is the worker's
adapter call. Worth deleting or wiring deliberately so they don't become a second
ungated post path later.

### Defect found and fixed

`SHADOW_MODE=true` had been set on the staging **discord-bot** (no effect — that
service does not post) while the staging **worker** was `false` (the service that
*does* post). Staging would have posted to real platforms.

**Fix applied:** `SHADOW_MODE=true` on `outpost-worker` in staging (Railway var).
Documented the gate + "must be on the worker" rule in `.env.example` so it cannot
recur.

## How you test in staging

1. Trigger activity that creates a ticket in staging (message/issue on a surface
   staging listens to).
2. Staging worker runs the full AI pipeline and writes a **shadow `Message` row**
   (`author: 'outpost-shadow'`, `attachments.shadowMode: true`) with the exact
   text it *would* have posted, plus confidence and latency.
3. Inspect those rows (staging DB / dashboard) to verify agent behavior. Nothing
   reaches real users.

## Follow-ups (not in this pass)

- **Isolated test surfaces** — give staging its own test bot token + a test Discord
  server / test GitHub App install so it never connects to prod communities. Then
  `SHADOW_MODE=false` in staging becomes safe for end-to-end post testing in a
  sandbox. (Belt-and-suspenders; shadow mode already makes staging safe today.)
- **Branch protection** — protect `main` (PR + review + CI, no force-push) and
  `production` (CI check, no force-push/delete, restricted push). Approved earlier;
  deferred to move fast.
- **Secret scanning** — Gitleaks in CI + GitHub Push Protection. Deferred.

## Repo changes in this pass

- `docs/deployment.md` — CI/CD section rewritten to the two-env staging→production
  model + promotion command + DB isolation + service split.
- `.env.example` — SHADOW_MODE documented (worker-only gate, staging=true).
- This spec.
- Railway (live, not repo): staging worker `SHADOW_MODE=true`.
