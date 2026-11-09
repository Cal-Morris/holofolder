# Inventory sync confirmation, unpublished draft

Do not publish: this is private transport preparation behind unconditional 503
routes, with no enabled production UI or supported new REST/MCP operation.

Proposed copy after the owning feature is enabled and verified:

> Inventory sync confirms the whole collection before clearing a pending edit.
> Interrupted or offline reads keep your saved collection and pending changes.

Release requires #376 supported API/docs, #379 conversion/bootstrap/exposure,
reviewed partner access to inherited owner grid settings, portable appearance/
asset handling where required, production host/lifecycle and queue binding and enabled authenticated/offline verification. Parent owns release.


Read/navigation extension, still unpublished:

> Open a saved copy's current storage location from Inventory, using its real
> collection layout. Custom-storage location notes and original collection source
> details stay private to you and your linked partner.

This copy is conditional on enabled host/rollout verification. The internal read
adapter now preserves location/provenance and uses actual catalog/grid evidence;
current partner RLS-hidden inherited grids remain unknown. Nothing in this PR
announces availability, adds sharing of location notes or ships a restore flow.
