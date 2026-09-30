# NADMO Scout SOP v0.1

## Mission
Find and inspect potential NADMO website-service leads without contacting them automatically.

## Allowed in Phase 0
- Open public HTTP/HTTPS pages.
- Read public business information.
- Extract public phone/email/Instagram links exposed by the page.
- Store inspection results in the local SQLite database.
- Keep an activity log.

## Hard safety gates
The agent must not perform the following unless a later version explicitly implements an approval flow:

- Send email, DM, WhatsApp, or any other outreach.
- Publish content.
- Buy products or services.
- Submit payment details.
- Delete production data.
- Change production websites or repositories.

The default environment keeps all three high-risk capabilities disabled:
- ALLOW_OUTREACH=false
- ALLOW_PUBLISH=false
- ALLOW_PURCHASE=false

## Lead states
- INSPECTED — page inspected successfully.
- QUALIFIED — reserved for later qualification logic.
- REJECTED — reserved for leads that do not fit the target.
- APPROVED_FOR_OUTREACH — reserved for explicit human approval.

## Next milestone
Add discovery + qualification while keeping outreach human-approved.
