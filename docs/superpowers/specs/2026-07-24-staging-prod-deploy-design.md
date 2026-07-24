# Staging + Production Deployment Model — Design

**Date:** 2026-07-24 (revised after review by Jordan Ritter)
**Status:** Repo changes done; Railway trigger cutover pending
**Owner:** Nathan

## Goal

Run a proper staging environment for testing, keep the model simple and fast, and make
it safe to test the auto-responding agent in staging without it replying to real users
in production communities.

## Deployment model

Two Railway environments in the `outpost` project, each with its **own** Postgres
(verified isolated — different DB credentials, staging never touches prod data).

`main` is the **known-good release line** — it is what production runs. Development
work lives on branches and merges into `staging` for integration testing. Nothing
reaches `main` until it has soaked on staging.

```
feature branch → PR → staging → auto-deploys STAGING → verify
release:        merge staging → main → auto-deploys PRODUCTION
```

| | staging | production |
| --- | --- | --- |
| Deploys from | `staging` branch (CI-gated) | `main` (CI-gated) |
| Web URL | outpost-web-staging.up.railway.app | outpost.copilotkit.ai |
| Database | own Postgres | own Postgres |
| Triggered services | web, github-app, discord-bot, worker | same 4 |
| `SHADOW_MODE` (worker) | **true** | false |
| Role | integration / soak | known good |

Other three services (slack-bot, teams-bot, linear-sync) are optional integrations,
left offline until their credentials are configured.

No release tags, no promote pipeline for now — the release is a `staging` → `main`
merge, which keeps `main`'s history as the record of what has been in production.
Rollback is a revert on `main`.

### Why this orientation

The first version of this design had it inverted: `main` deployed staging and a
separate `production` branch deployed prod. Jordan flagged it in review — by
convention `main` is the known-good branch and everything else is work in progress,
so the original scheme read backwards to anyone joining the repo and made `main`
the least trustworthy branch. This revision matches the standard.

### Cutover (from the inverted scheme)

Ordering matters, because Railway's deploy triggers wait for a CI check suite and
`main` currently carries commits that have not yet been in production.

1. Create the `staging` branch from `main` so staging keeps testing the same content. **(done)**
2. CI runs on `main` and `staging`, so no deploy trigger is left waiting on a check
   suite that never arrives. **(done)**
3. Repoint the staging environment's 4 deploy triggers from `main` to `staging`. **(done)**
4. Repoint the production environment's 4 deploy triggers from `production` to `main`. **(done)**
   Staging had to move first: with both environments pointed at `main`, a single push
   would have deployed staging and production at once, leaving no soak window.
5. Delete the `production` branch (was `1fd883e`, fully contained in `main`) and drop it
   from the CI trigger list. **(CI trigger done; branch deletion pending)**
6. Protect `main` as the production branch (see follow-ups).

Verified after cutover: production deploys from `main` with `SHADOW_MODE=false`,
staging deploys from `staging` with `SHADOW_MODE=true`, and all eight triggers still
wait for CI. Repointing a trigger does not retroactively redeploy — production picks up
`main` on the next push to it.

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
- **Branch protection** — `main` is now the production branch, so it needs the
  strictest rules: PR + review + CI required, no force-push, no deletion. `staging`
  wants CI required and force-push/deletion blocked. A review requirement already
  exists on `main`; the rest is unverified from non-admin access. Owner: Jordan.
- **Secret scanning** — Gitleaks in CI + GitHub Push Protection. Deferred.

## Repo changes in this pass

- `docs/deployment.md` — CI/CD + environments sections written to the corrected model
  (`staging` → staging env, `main` → production), release workflow, DB isolation,
  service split, shadow-mode section, `HEALTH_PORT` collision note.
- `.env.example` — `SHADOW_MODE` documented (gate lives in the worker, staging=true);
  `HEALTH_PORT` documented as shared by worker + teams-bot.
- `.github/workflows/ci.yml` — CI runs on `main`, `staging`, and (transitionally)
  `production`.
- `packages/outpost/queue/src/handlers/onboarding-digest.ts` — gated on `SHADOW_MODE`,
  with tests.
- `staging` branch created from `main`.
- This spec.
- Railway (live, not repo): staging worker `SHADOW_MODE=true`; prod `GUILD_ID`
  corrected to the official CopilotKit server.
