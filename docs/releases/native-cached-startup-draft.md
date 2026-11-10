# Unpublished: Saved native collections at startup

Draft contribution to #363/#386/#379. Do not publish or describe as shipped.

Reopen this device's saved Inventory or collection Binder/List when the connection drops. Previously saved copies and pending layout changes are labelled Cached only. Reconnecting checks current account and collection access before returning to live data. Pending edits stay on the device if app files or saved evidence need attention.

Current internal local-test behavior is display-only at offline startup. It requires previously cached app files, canonical saved collection evidence and the same unexpired device session; partner access follows the existing saved scoped-access policy. It does not prove current offline membership or accept remote writes. Production remains on legacy startup and native admission remains denied.

Before publication: parent must complete independent review, deployed native admission, authenticated command/replay integration, supported APIs/docs, real owner/partner lifecycle, hosted conversion and old-client/SW compatibility, full backup restore, consumer/share/scanner and recovery gates. Attach exact deployed SHA, live help/API and Framer release/changelog URLs. No publication or hosted acceptance is claimed by this slice.
