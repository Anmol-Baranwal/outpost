---
name: Ticket Resolved
subject: "[{{ticket.displayId}}] Your request has been resolved"
from: "{{org.name}} Support <{{org.email}}>"
---

Hi {{customer.name}},

Your support ticket **{{ticket.displayId}}** has been resolved.

**{{ticket.title}}**

{{ticket.resolution}}

If you have any further questions or the issue persists, you can reopen the ticket by replying to this email or visiting:

[View Ticket]({{ticket.url}})

— {{org.name}} Support
