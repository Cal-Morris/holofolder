# Multiple binders: design

## Model
- `public.binders`: `id uuid pk`, `owner_user_id uuid → auth.users (cascade)`, `name text (1–40)`, `color text null`,
  `sort_order int`, `is_default bool`, `binder_rows/binder_cols int null` (NULL = inherit `user_settings`),
  `created_at`, `updated_at`. One default per owner (partial unique index). `UNIQUE (id, owner_user_id)` so
  child rows can use a composite FK.
- Every binder is a full National Dex binder (one slot per Pokémon), the same as today.
- `pokemon_collection.binder_id uuid`, with composite FK `(binder_id, user_id) → binders(id, owner_user_id) ON DELETE CASCADE`.
  The binder must belong to the row's owner, so a row can't sit in someone else's binder. Unique `(binder_id, pokemon_id)`
  replaces `(user_id, pokemon_id)`.
- Partners: unchanged. A partner resolves to the owner (`resolveCollectionOwnerUserId`), and binders are owned by the owner,
  so the partner gets every binder automatically. RLS on `binders` uses the same `owner_user_id IN (partnerships…)`
  check as `pokemon_collection`. Writes go through `/api/binders` (service role, after owner resolution); creation calls `developer_create_binder`, which also writes the native slots state (migration 105).

## Migration (zero data loss, live-safe)
1. `039` (additive, old code keeps working): create `binders`; insert one "My binder" default per existing owner;
   add nullable `binder_id`; backfill every row into its owner's default; a `BEFORE INSERT` trigger fills a missing
   `binder_id` with the owner's default (creating it if needed), so old clients' inserts still land; FK; concurrent
   unique `(binder_id, pokemon_id)` and `(binder_id, updated_at)` indexes. Old `(user_id, pokemon_id)` unique stays.
   `binder_shares.binder_id` (nullable = default binder) plus a unique `(owner_user_id, binder_id) NULLS NOT DISTINCT`.
2. Code deploy: every read and write is scoped by `binder_id`, and upserts use `onConflict: binder_id,pokemon_id`.
3. `040` (after step 2 is live): `binder_id SET NOT NULL`, drop `UNIQUE (user_id, pokemon_id)` and the owner-only share unique.
   Only after this can a second binder hold the same Pokémon, so the create-binder UI ships after it.
Verification: row count, owned and wanted counts, and an md5 over (pokemon_id, card, status, wanted) match before and after.

## Owned and wanted across binders
- Per binder: slots, status and wanted printings belong to a binder. Editing and the binder view always use the open
  binder; nothing about a binder's own status changes when other binders exist.
- All-binders lookup: the legacy cross-binder read from `pokemon_collection` rows was
  removed with the legacy client model. The All binders scope toggles in Wanted and Analytics only appear when a host passes
  cross-binder data, which no host does today.
- Search and the Pokémon views show "Owned in <binder>" when another binder holds the Pokémon; the card browser shows
  "In <binder>" on printings another binder owns.
- Analytics and the want list have a "This binder / All binders" toggle, remembered per view on the device. In All
  binders, species count once, each binder's copy of a card counts (and is valued) separately, and other binders'
  wanted cards are tagged "In <binder>" and are view only (open that binder to edit them).
- Price refresh tracks cards from every binder (it reads all collection rows already).

## Client and offline
- The server bootstrap resolves the binder from `?binder=`, then the `binderdex_binder` cookie (last opened, per device),
  then the default. It passes `binderId` and the binder list to the client. Switching binders navigates and remounts the app (`key=binderId`).
- Delta-sync baselines are keyed by owner + binder. Queued edits carry `binderId` and the API writes to that binder;
  edits for another binder still flush, but only update the screen when that binder is open.
- Each binder has its own offline copy. The default binder keeps the original keys (`pokemon_collection_snapshot_v1` in
  localStorage, the `collection` record in IndexedDB), so data saved before multiple binders still opens. Other binders use
  `pokemon_collection_snapshot_v1:<binderId>` and `collection:<binderId>`. A snapshot carries `binderId` and is only applied to
  that binder. The pending-edit queue stays one list (each edit carries its `binderId`) and lives with the default record.
- The binder list is remembered on the device (`binderdex_device_binders_v1`: owner, binders, which ones have a saved copy).
  Offline, the switcher opens binders saved on this device and greys out the rest ("Needs a connection"). An offline switch
  is a full page load, so the cached app shell boots the chosen binder from its own copy. If a binder that isn't saved is
  requested offline, the shell shows the last opened saved binder with a short notice. A partner sees the owner's list.
- Realtime stays per owner, so any binder change triggers a (cheap) delta refresh.

## Share links
`binder_shares.binder_id` (NULL = default). One link per binder; `/share/[token]` loads that binder's rows.

## UI
Tap the binder name in the header to open a bottom sheet (shared overlay primitive) listing binders with slot counts. From there you can:
open a binder, create one (name), rename it, move it up or down, and delete it. Deleting needs a confirm step; a non-empty binder needs the name typed or a
second explicit confirm, and the last binder can never be deleted. Deleting the default binder promotes the next one.
