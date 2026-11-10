# Graded Inventory placement, unpublished draft

Staged preparation for #383/#385. Do not publish until the parent verifies enabled production behavior and the whole release block.

Proposed copy when enabled:

> Place an existing graded copy from Inventory. Choose its exact destination, review any occupied copy, then assign, move or unassign without changing ownership. Recorded grading, certificate and private label details stay with the same physical copy.

Graded removal, graded bulk actions and creating grading are outside this slice. Removal stays unavailable because recovery cannot verify private label assets. Placement requires a fresh complete authorized read; cached Inventory stays read-only. Saving on device, remote sync and fresh-read confirmation are separate. Unknown outcomes retain the original request. Activity uses the exact acknowledged operation, with conditional recovery and no promised Undo.

The app composes existing REST/MCP inventory commands, with private fields preserved and no new endpoint or schema. Native admission remains fixed503, with zero conversions. Help: `/app/docs/native-storage`. Parent owns review, merge, deployment, hosted/device proof, issue/project acceptance and publication. Synthetic six-phone evidence does not establish those gates.
