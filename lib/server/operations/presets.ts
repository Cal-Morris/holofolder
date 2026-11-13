import 'server-only';
import { blankPreset, speciesPreset } from '@/lib/binder-creation-draft';
import { normalizePresetManifest } from '@/lib/domain/binder-presets';
import { POKEMON_CATALOG } from '@/lib/pokemon-catalog';
import { GENERATIONS } from '@/lib/pokemon-generations';
import {
  PRESET_OPERATIONS,
  COPIED_PRESETS,
  PRESET_PREVIEW_LIMITS as limits,
  PRESET_PERMISSIONS,
  presetPreviewInput,
} from '@/lib/developer-api/presets';
import { paginateEntries } from '@/lib/developer-api/pagination';
import { DeveloperAccessError, requirePermissions } from '@/lib/developer-api/permissions';
import type { OperationContext } from '@/lib/developer-api/types';
import { readDeveloperScope } from '@/lib/server/developer-access/native-read';
import { readPresetPrintings } from '@/lib/server/preset-catalog';

export async function executePresetOperation(context: OperationContext, name: string, input: unknown) {
  const operation = PRESET_OPERATIONS.find((op) => op.name === name);
  if (!operation) throw new DeveloperAccessError('not_found', 'Preset operation not found.', 404);
  requirePermissions(context.principal.permissions, operation.permissions);
  const parsed = operation.schema.safeParse(input);
  if (!parsed.success) throw new DeveloperAccessError('invalid_input', 'Invalid or oversized preset query.', 400);
  const controller = new AbortController(),
    deadline = Date.now() + limits.timeoutMs;
  let requests = 0,
    bytes = 0;
  const exhausted = () =>
    new DeveloperAccessError(
      'preset_read_unavailable',
      'Preset preview exceeded its finite read budget. No partial preview was returned.',
      503,
    );
  const check = () => {
    if (controller.signal.aborted || Date.now() >= deadline || ++requests > limits.catalogRequests) throw exhausted();
  };
  const account = (value: unknown) => {
    bytes += Buffer.byteLength(JSON.stringify(value));
    if (bytes > limits.catalogBytes) throw exhausted();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const { createAdminClient } = await import('@/lib/supabase/admin');
        const db = createAdminClient(),
          scope = () => readDeveloperScope(db, context, 'scope', {}, PRESET_PERMISSIONS);
        const before = await scope();
        const envelope = { projection: 'copied-preset-preview-v1', completeSnapshot: false };
        let result: unknown;
        if (name === 'list_storage_presets') {
          const params = new URLSearchParams(Object.entries(parsed.data).map(([k, v]) => [k, String(v)]));
          result = { ...envelope, ...paginateEntries(COPIED_PRESETS, params, (p) => p.id), limits };
        } else {
          const query = presetPreviewInput.parse(parsed.data),
            preset = COPIED_PRESETS.find((p) => p.id === query.presetId);
          if (!preset) throw new DeveloperAccessError('not_found', 'Preset not found.', 404);
          if (!preset.supported) throw new DeveloperAccessError('unsupported_preset_scope', preset.limitation!, 422);
          if (
            (query.presetId !== 'selected-species' && query.speciesIds !== undefined) ||
            (query.presetId !== 'selected-printings' && query.printings !== undefined)
          )
            throw new DeveloperAccessError('invalid_input', 'Selection fields must match the chosen preset.', 400);
          const gen = GENERATIONS.find((g) => `generation-${g.id}` === query.presetId);
          const ids =
            query.presetId === 'selected-species'
              ? query.speciesIds
              : POKEMON_CATALOG.flatMap((p) => (!gen || (p.id >= gen.start && p.id <= gen.end) ? [p.id] : []));
          if (
            (query.presetId === 'selected-species' && (!ids || new Set(ids).size !== ids.length)) ||
            (query.presetId === 'selected-printings' && !query.printings)
          )
            throw new DeveloperAccessError(
              'invalid_input',
              'Supply the explicit ordered selection; duplicate species are not supported.',
              400,
            );
          const manifest =
            query.presetId === 'blank'
              ? blankPreset()
              : query.presetId === 'selected-printings'
                ? await readPresetPrintings(db, query.printings!, controller.signal, check, account)
                : speciesPreset(preset.name, ids!, preset.id);
          // Re-read public evidence within the same budget. Mutable catalog changes fail closed.
          if (query.printings) {
            const again = await readPresetPrintings(db, query.printings, controller.signal, check, account);
            if (JSON.stringify(again) !== JSON.stringify(manifest))
              throw new DeveloperAccessError(
                'preset_catalog_changed',
                'Catalog changed. Request a fresh preview.',
                409,
              );
          }
          result = {
            ...envelope,
            preset: { id: preset.id, version: preset.version },
            manifest: normalizePresetManifest(manifest),
            scope: {
              kind: preset.id,
              ...(query.printings
                ? { printings: query.printings }
                : query.presetId === 'blank'
                  ? {}
                  : { speciesIds: ids }),
            },
            targetCount: manifest.entries.length,
            freeSlotCount: 0,
            ownershipCreated: false,
            exclusions: [
              'Set/master-set preview generation and complete variant coverage are unsupported here. Reviewed manifest.setScope can be persisted through creation with migration 101.',
              ...(query.printings
                ? [
                    'Only explicitly selected mirrored row IDs; no exhaustive species/form/set search or alias resolution.',
                  ]
                : ['No separate species-form identities or card-printing expansion.']),
            ],
            unknowns: query.printings?.some((p) => !p.finish)
              ? ['Omitted finish is unconstrained, not evidence that any particular finish exists.']
              : [],
          };
        }
        const after = await scope();
        if (JSON.stringify(before) !== JSON.stringify(after))
          throw new DeveloperAccessError(
            'native_read_forbidden',
            'Current developer scope changed. Authenticate again.',
            403,
          );
        const output = operation.responseSchema!.parse(result);
        if (Buffer.byteLength(JSON.stringify(output)) > limits.responseBytes) throw exhausted();
        return output;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(exhausted());
        }, limits.timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
