---
name: Ticket Created
subject: "[{{ticket.displayId}}] We received your request"
from: "{{org.name}} Support <{{org.email}}>"
---

Hi {{customer.name}},

We've received your support request and created ticket **{{ticket.displayId}}**.

**{{ticket.title}}**

Our team will review your request and get back to you shortly. You can check the status of your ticket at any time:

[View Ticket]({{ticket.url}})

— {{org.name}} Support
