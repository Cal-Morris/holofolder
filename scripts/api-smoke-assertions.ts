import { PRESET_OPERATIONS } from '../lib/developer-api/presets';
import {
  rawRestoreErrorSchema,
  creationErrorSchema,
  importErrorSchema,
  storageCommandErrorSchema,
} from '../lib/developer-api/storage';
import { NATIVE_READ_OPERATIONS } from '../lib/developer-api/native-read';
import assert from 'node:assert/strict';
import { NATIVE_DEVELOPER_OPERATIONS } from '../lib/developer-api/storage';

type Row = Record<string, unknown>;
type Check = (value: Row, input: Row) => void;
const object = (value: unknown): Row => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object');
  return value as Row;
};
const string = (value: unknown) => assert.equal(typeof value, 'string', 'Expected a string');
const array = (value: unknown): unknown[] => {
  assert.ok(Array.isArray(value), 'Expected an array');
  return value;
};
const page: Check = (value, input) => {
  assert.ok(array(value.data).length <= Number(input.limit ?? 50), 'Page exceeds requested limit');
  assert.ok(value.nextCursor === null || typeof value.nextCursor === 'string', 'Missing pagination cursor');
};
const binders: Check = (value) => {
  for (const item of array(value.binders)) {
    const row = object(item);
    string(row.id);
    assert.ok(Number.isSafeInteger(row.slotCount) && Number(row.slotCount) >= 0, 'Invalid slot count');
  }
};
const settings: Check = (value) => {
  object(value.settings);
  string(value.fingerprint);
  assert.equal(typeof value.hasStoredSettings, 'boolean');
};
const appearance: Check = (value) => {
  assert.ok(value.design === null || typeof value.design === 'object');
  assert.ok(Number.isSafeInteger(value.revision) && Number(value.revision) >= 0);
};
const job: Check = (value) => {
  const row = object(value.job);
  string(row.id);
  assert.ok(
    ['queued', 'running', 'completed', 'cancelled', 'failed'].includes(String(row.status)),
    'Unknown job state',
  );
};
const identity: Check = (value) => {
  assert.ok(value.username === null || typeof value.username === 'string');
  assert.ok(value.displayName === null || typeof value.displayName === 'string');
};
const binderIdentity: Check = (value) => {
  assert.ok(value.username === null || typeof value.username === 'string');
  assert.ok(value.slug === null || typeof value.slug === 'string');
};
const sharing: Check = (value) => {
  if (value.share !== null) {
    const share = object(value.share);
    string(share.token);
    assert.equal(typeof share.is_enabled, 'boolean');
  }
};
const checks: Check = (value) => {
  object(value.errors);
  for (const source of ['ebay', 'soldcomps'])
    if (value[source] !== null) {
      const result = object(value[source]);
      object(result.summary);
      string(result.checkedAt);
    }
};
const succeeded: Check = (value) => assert.equal(value.success, true);
const id: Check = (value) => string(value.id);
const catalog: Check = (value) => {
  string(value.id);
  assert.equal(value.game, 'pokemon');
};
const catalogPage: Check = (value, input) => {
  page(value, input);
  for (const row of array(value.data)) catalog(object(row), input);
};

// Every registered operation needs a successful response assertion, including mutations.
export const API_SMOKE_ASSERTIONS: Record<string, Check> = {
  ...Object.fromEntries(
    [...NATIVE_DEVELOPER_OPERATIONS, ...NATIVE_READ_OPERATIONS, ...PRESET_OPERATIONS].map((operation) => [
      operation.name,
      (value: Row) => {
        assert.ok(operation.responseSchema?.safeParse(value).success, 'Invalid native receipt for ' + operation.name);
      },
    ]),
  ),
  list_cards: catalogPage,
  get_card: (value, input) => {
    catalog(value, input);
    assert.equal(value.id, input.id);
    string(value.canonicalId);
    catalog(object(value.set), input);
    assert.ok(value.image === null || typeof value.image === 'string');
  },
  list_sets: catalogPage,
  get_set: (value, input) => {
    catalog(value, input);
    assert.equal(value.id, input.id);
  },
  list_series: catalogPage,
  get_series: (value, input) => {
    catalog(value, input);
    assert.equal(value.id, input.id);
  },
  list_languages: (value) => assert.ok(array(value.data).includes('en')),
  list_pokemon: page,
  get_pokemon: (value, input) => assert.equal(value.id, Number(input.id)),
  list_illustrators: page,
  list_binders: binders,
  create_binder: (value, input) => {
    binders(value, input);
    string(value.createdBinderId);
    assert.ok(array(value.binders).some((row) => object(row).id === value.createdBinderId));
  },
  update_binder: (value, input) => {
    binders(value, input);
    assert.equal(object(array(value.binders).find((row) => object(row).id === input.id)).name, input.name);
  },
  reorder_binders: (value, input) => {
    binders(value, input);
    assert.deepEqual(
      array(value.binders).map((row) => object(row).id),
      input.order,
    );
  },
  delete_binder: (value, input) => {
    binders(value, input);
    assert.equal(value.deletedBinderId, input.id);
    assert.ok(!array(value.binders).some((row) => object(row).id === input.id));
  },
  get_settings: settings,
  update_settings: settings,
  get_prices: (value) => {
    array(value.prices);
  },
  refresh_prices: (value) => {
    array(value.prices);
    for (const key of ['refreshed', 'cached', 'unpriced'])
      assert.ok(Number.isSafeInteger(value[key]) && Number(value[key]) >= 0);
  },
  get_price_checks: checks,
  refresh_price_checks: (value, input) => {
    checks(value, input);
    assert.equal(
      object(value.errors)[String(input.source ?? 'ebay')],
      undefined,
      'Requested comparison provider returned an error',
    );
  },
  get_comparison_job: job,
  inspect_comparison_job: (value) => {
    assert.ok(Number.isSafeInteger(value.needed) && Number(value.needed) >= 0);
    assert.ok(value.job === null || typeof value.job === 'object');
  },
  start_comparison_job: job,
  cancel_comparison_job: job,
  get_price_history: page,
  list_collection_audit: page,
  get_collection_audit: (value) => {
    assert.equal(typeof value.id, 'string');
    assert.ok(['unknown', 'user', 'system'].includes(String(value.actor_kind)));
    assert.ok(!('recovery_state' in value));
    assert.ok(!('command_evidence' in value));
  },
  check_deal: (value) => {
    assert.equal(value.currency, 'GBP');
    assert.ok(value.verdict === null || typeof value.verdict === 'object');
  },
  get_pokemon_set_slots: (value, input) => {
    page(value, input);
    assert.equal(object(value.selectedSet).id, input.id);
  },
  get_listings: (value) => {
    object(value.summary);
    array(value.listings);
    string(value.checkedAt);
  },
  get_identity: identity,
  update_identity: identity,
  get_binder_identity: binderIdentity,
  update_binder_identity: binderIdentity,
  get_sharing: sharing,
  update_sharing: sharing,
  get_appearance: appearance,
  update_appearance: appearance,
  list_partners: (value) => {
    array(value.invites);
    assert.ok(value.partnership === null || typeof value.partnership === 'object');
  },
  invite_partner: id,
  accept_partner_invite: succeeded,
  reject_partner_invite: (value) => assert.equal(value.rejected, true),
  disconnect_partner: succeeded,
  list_show_purchases: page,
  add_show_purchase: (value, input) => assert.equal(object(value.purchase).id, input.clientId),
  remove_show_purchase: (value) => assert.equal(value.removed, true),
  prepare_artwork_upload: (value) => {
    string(value.signedUploadUrl);
    object(value.headers);
    assert.equal(value.method, 'PUT');
    assert.equal(value.storage, 'r2-private');
  },
  get_artwork: (value, input) => {
    assert.equal(value.id, input.id);
    assert.equal(value.storage, 'r2-private');
    const url = new URL(String(value.downloadUrl));
    assert.ok(
      url.hostname.endsWith('.r2.cloudflarestorage.com') && url.searchParams.has('X-Amz-Signature'),
      'Expected a private signed R2 download',
    );
  },
};
export function assertSmokeResponse(operation: string, value: unknown, input: Row) {
  const check = API_SMOKE_ASSERTIONS[operation];
  assert.ok(check, 'Missing response assertion for ' + operation);
  check(object(value), input);
}

/** Terminal rejection is an error outcome, never successful execution coverage or an inferred conflict. */
export function assertTerminalStorageSmokeResponse(operation: string, value: unknown, input: Row) {
  const registered = NATIVE_DEVELOPER_OPERATIONS.find((op) => op.name === operation);
  assert.ok(registered?.errorSchemas?.[409], 'Operation has no terminal rejection contract');
  const schema =
    operation === 'restore_raw_collection_content'
      ? rawRestoreErrorSchema
      : operation === 'create_storage_collection'
        ? creationErrorSchema
        : operation === 'import_storage_arrangement'
          ? importErrorSchema
          : storageCommandErrorSchema;
  const parsed = schema.parse(value);
  assert.equal(
    parsed.error.rejection.operationId,
    input.operationId,
    'Terminal proof must bind the original operation ID',
  );
}

/** Called before a sample is marked passed or persisted, including error-body checks. */
export function assertSmokeHttpResponse(
  operation: string,
  status: number,
  value: unknown,
  input: Row,
  expectedStatus: number,
  _scenario: string,
) {
  assert.ok(API_SMOKE_ASSERTIONS[operation], 'Missing response assertion for ' + operation);
  assert.equal(status, expectedStatus, `Unexpected HTTP status for ${operation}`);
  if (expectedStatus < 400) assertSmokeResponse(operation, value, input);
  else {
    const error = object(object(value).error);
    string(error.code);
  }
}
