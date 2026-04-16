---
name: Ticket Escalated
subject: "Escalation: {{ticket.displayId}} — {{ticket.title}}"
from: "{{org.name}} Alerts <{{org.email}}>"
---

**Ticket Escalated**

Ticket **{{ticket.displayId}}** has been escalated by {{escalation.by}}.

| Field | Value |
|-------|-------|
| **Ticket** | [{{ticket.displayId}}]({{ticket.url}}) |
| **Title** | {{ticket.title}} |
| **Priority** | {{ticket.priority}} |
| **Previous Assignee** | {{escalation.from}} |
| **New Assignee** | {{escalation.to}} |

**Reason**: {{escalation.reason}}

Please review and take action promptly.

— Outpost Alerts
