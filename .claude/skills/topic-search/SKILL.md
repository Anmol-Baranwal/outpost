---
name: topic-search
description: Generic ad-hoc topic search across CopilotKit + AG-UI Discord/GitHub. "Find all reports about <topic> in the last <N> days." Returns a structured chronological list with reporter handles + 1-line summaries + optional enterprise enrichment. Triggers on "find all reports about", "search across both communities", "look for X in last N days".
---

# Topic search

Ad-hoc lookup tool for "I want to know everyone who reported X."

## Inputs

- **Topic keyword(s)** — required. E.g. "ADK threads", "webhooks", "rate limiting", "Mastra streaming".
- **Date window** — required. Default: last 90 days. Accept "last 30 days", "last quarter", explicit ISO dates.
- **Scope** — optional. CopilotKit only / AG-UI only / both (default). Filters which Discord servers + GitHub repos to search.
- **Enrichment** — optional. If set, run `enrich-reporter` on every GitHub author found.

## Flow

1. **Compute window.** Today minus the requested span → ISO range.

2. **GitHub search per repo in scope:**
   ```bash
   gh issue list --repo <repo> --state all --limit 100 --search "<keyword> created:<start>..<end>" --json number,title,url,author,createdAt,state
   ```
   Run multiple `--search` variants for synonym coverage if needed (e.g. "thread" + "session" + "ADK").

3. **Discord per server in scope:**
   - Text channels: `mcp__discord__read_messages` with `limit: 100`, then keyword-filter in-memory.
   - Forum channels: `mcp__discord__list_forum_threads`, filter thread titles + creation dates, then `mcp__discord__read_thread_messages` for any title matching the keyword.

4. **Optional enrichment** (if `enrichment=true`): spawn `enrich-reporter` subagent on the unique GitHub author list.

5. **Sort chronologically** oldest → newest.

6. **Render** as structured list per "Output shape" below.

## Output shape

```
## <Topic> — last <N> days (<start> → <end>)

**<X> reports · <Y> distinct reporters · <Z> enterprise affiliations**

### Reports — <repo or community 1>

- **YYYY-MM-DD** · 💬 [<reporter>](<thread-url>) [🏢 <Company>] — one-line summary.
- **YYYY-MM-DD** · 🐛 [#NNNN](<issue-url>) [<reporter>](<github-url>) [🏢 <Company>] · <state> — one-line summary.
- ...

### Reports — <repo or community 2>

- ...

### Enterprise affiliations (if enrichment ran)

- **<Name>** 🏢 **<Company>** — <N> reports across <which surfaces>.

### Themes (optional, 2-4 patterns spanning the results)

1. **Headline.** Body sentence with linked refs.
2. ...

### Suggested next actions (optional)

- Reach out to <enterprise reporter>.
- Triage <hottest open issue>.
- Publish docs for <recurring docs gap>.
```

## When to render the optional sections

- **Themes:** include when ≥5 reports and a clear cross-cutting pattern emerges. Skip for narrow lookups.
- **Suggested next actions:** include when the search surfaces unresolved enterprise signal or undeclared volume reporters.

## Output destination

Default: chat reply (in-conversation Markdown). Caller can ask for a Notion page if they want it durable — use `mcp__plugin_Notion_notion__notion-create-pages` under the Community Signals parent with a topic-prefixed title like `Topic Search — <Topic> — <Mon DD>-<DD>`.

## Cross-references

- `enrich-reporter` — for the enterprise affiliation enrichment pass
- `weekly-report` — uses similar patterns but always Fri→Fri scoped and produces full report

## Discord channel coverage

When scope includes Discord:

**CopilotKit** (server `1122926057641742418`):
- `#💬｜general` text `1182553320540352563`
- `#🤔｜support` forum `1313616713647919218`

**AG-UI** (server `1379082175625953370`):
- `#🔧-building` text `1379082271642095738`
- `#✈️-support` forum `1384529894972592158`

## Conventions

- One-sentence bullets per report (date · source · linked reporter · summary).
- Deep technical detail goes in Themes, not in the report list.
- Forum thread URL format: `https://discord.com/channels/<guild_id>/<thread_id>` — no parent channel ID.
- Quote the reporter's wording for classification; don't infer "broken" if they didn't say it.
