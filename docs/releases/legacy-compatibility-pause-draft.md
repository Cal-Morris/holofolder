# Draft: Keep incompatible legacy edits on this device

When a binder requires a compatible client, queued legacy edits now stay saved on the device. The app pauses sending them and explains that sync needs a compatible client, instead of treating the rejection as an ordinary row conflict.

This change preserves pending intent. It does not sync or translate those edits, enable native editing, recover missing recipient bindings, or complete guest acceptance and multi-tab durability. Keep #363 and #379 open. Publish only after the parent verifies release; no hosted or physical-device proof is claimed here.
