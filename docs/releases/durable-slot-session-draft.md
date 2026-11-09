# Durable slot editing, unpublished draft

Do not publish: this is internal synthetic integration, not an enabled customer feature.

Once the owning feature is enabled and verified, proposed copy:

> Slot edits save on your device before showing Pending sync. If storage is full, retry the same draft after freeing space. Interrupted sync retains the original edit, and a fresh complete owner read confirms replay before the pending record is acknowledged.

Release requires #363 literal acceptance, authenticated command/recovery binding, #365/#379 recipient/conversion/bootstrap and production offline proof, plus #376 supported API/docs. This slice changes no public endpoint and publishes no Framer announcement. Parent owns review, merge and deployed/enabled verification.
