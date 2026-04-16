---
name: SLA Breach Alert
subject: "SLA Breach: {{ticket.displayId}} — {{ticket.title}}"
from: "{{org.name}} Alerts <{{org.email}}>"
---

**SLA Breach Alert**

Ticket **{{ticket.displayId}}** has breached its SLA.

| Field | Value |
|-------|-------|
| **Ticket** | [{{ticket.displayId}}]({{ticket.url}}) |
| **Title** | {{ticket.title}} |
| **Priority** | {{ticket.priority}} |
| **Assignee** | {{ticket.assignee}} |
| **SLA Target** | {{sla.target}} |
| **Time Elapsed** | {{sla.elapsed}} |

Please take immediate action to address this ticket.

— Outpost Alerts
