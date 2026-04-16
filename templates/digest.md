---
name: Daily Onboarding Digest
subject: "{{org.name}} — Daily Digest for {{digest.date}}"
from: "{{org.name}} <{{org.email}}>"
---

Hi {{member.name}},

Here's your daily summary for **{{digest.date}}**:

**Tickets**
- Open: {{digest.openTickets}}
- Resolved today: {{digest.resolvedToday}}
- Breached SLA: {{digest.breachedSla}}

**Your Assignments**
- Assigned to you: {{digest.assignedToYou}}
- Awaiting response: {{digest.awaitingResponse}}

[View Dashboard]({{app.url}}/dashboard)

— {{org.name}}
