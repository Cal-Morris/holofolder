# Inventory occupied destinations, unpublished draft

Status: staged preparation for #383/#385, not enabled or announced. #379 admission
and whole-feature acceptance remain with the parent. Do not publish this copy or
attach a live rollout claim before those gates pass.

## Draft copy

Moving a raw copy to an occupied storage slot asks what should happen to the copy
already there. Keep it in Inventory as Unassigned, or swap the two copies when
both fit their new slots. Review both exact copies and locations before confirming,
or cancel without changing either copy.

Your ownership count, recorded grading and acquisition details stay the same.
Targets and wants stay with their slots, and moving a copy does not clear wants.
After sync, Find acknowledged change can locate the exact Activity entry. Recovery
is checked against current storage and may be unavailable.

## Actual boundary

Existing atomic assign supports occupied-copy unassignment. Existing move also
supports compatible swap. Unassigned sources cannot swap. Selected graded-copy
ownership management and bulk actions remain outside this UI. Recorded graded
destination copies are retained through exact existing refs with metadata intact.
Unknown printing stays unknown; it cannot satisfy an unproven constrained target.
Current complete online scoped storage is required. Pending commands of every
family and unresolved recovery block new actions; unknown outcomes retain the
original reviewed operation and decision in the existing durable queue.

REST/MCP use the unchanged execute_inventory_commands contract with privateFields
preserve, exact refs and fulfillWant null. No registry, OpenAPI, backend, SQL,
migration, queue protocol or production admission changes. First-party and public
native production routes stay private/no-store 503. No Framer/CMS publication,
hosted/SQL writes, provider access or physical-device verification is claimed.
