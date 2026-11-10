# Unpublished: reliable collection sync

Draft contribution to #363/#379. Hidden local proof only, not shipped, do not publish.

Saved collection edits stay on this device until the server confirms the same command and the app checks the complete current inventory. A dropped connection retries the original edit, including after reload. Access or billing problems keep the edit available; changed storage pauses it for review.

Before publication: complete reviewed conflict reconciliation, native recovery/Undo, supported APIs/help, rollout and conversion/backup checks, startup and installed-PWA offline relaunch, owner/partner proof, independent review, CI, serialized merge and deployed enablement. Add verified app SHA/deployment and live help/API/Framer URLs then. Current legacy Activity/Undo is already a separate capability and must not be described as native recovery.
