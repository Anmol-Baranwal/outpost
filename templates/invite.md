---
name: Team Member Invite
subject: "You've been invited to join {{org.name}}"
from: "{{org.name}} <{{org.email}}>"
---

Hi {{member.name}},

You've been invited to join **{{org.name}}** on Outpost.

{{member.invitedBy}} has added you as a **{{member.role}}**. Click the link below to accept your invitation and set up your account:

[Accept Invitation]({{invite.url}})

This invitation will expire in {{invite.expiresIn}}.

If you weren't expecting this invite, you can safely ignore this email.

— The {{org.name}} Team
