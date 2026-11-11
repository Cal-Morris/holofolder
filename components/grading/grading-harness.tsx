'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { closeAllOverlays } from '@/hooks/use-overlay';
import type { InventoryItem } from '@/lib/domain/inventory';
import { emptyGradingRecord } from '@/lib/grading/draft';
import type { GradingCommitResult } from '@/lib/grading/draft';

const GradingEditor = dynamic(() => import('./grading-editor'), { ssr: false });
// Synthetic per-copy drafts, never account/API/queue/storage state.
const initial: InventoryItem[] = [
  {
    id: 'synthetic-copy-raw',
    ownerUserId: 'synthetic-owner',
    identity: { kind: 'card', cardId: 'synthetic-card' },
    grading: null,
    acquiredAt: '2026-01-01T00:00:00Z',
    version: 2,
  },
  {
    id: 'synthetic-copy-ace',
    ownerUserId: 'synthetic-owner',
    identity: { kind: 'card', cardId: 'synthetic-card' },
    grading: {
      ...emptyGradingRecord(),
      provider: { kind: 'known', id: 'ace' },
      grade: '9',
      certificate: '00001234',
      label: { variant: 'Synthetic ACE legacy edition', assetIds: ['synthetic-private-label'] },
    },
    acquiredAt: null,
    version: 3,
  },
];

export default function GradingHarness() {
  const [items, setItems] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [sink, setSink] = useState('draft');
  const [notice, setNotice] = useState('');
  const item = items.find((i) => i.id === selected);
  return (
    <main
      style={{
        padding: 'calc(env(safe-area-inset-top, 0px) + 1rem) 1rem var(--dock-clearance)',
        overflowWrap: 'anywhere',
      }}
    >
      <h1>Synthetic grading drafts, not persisted</h1>
      <label>
        Harness sink
        <select
          aria-label="Harness sink"
          value={sink}
          onChange={(e) => setSink(e.target.value)}
          style={{ minHeight: 44 }}
        >
          <option value="pending">Pending persistence</option>
          <option value="draft">Local draft only</option>
          <option value="reject">Reject persistence</option>
          <option value="queued">Incorrect enqueue receipt</option>
          <option value="throw">Failed persistence</option>
        </select>
      </label>
      {items.map((i) => (
        <section key={i.id}>
          <button style={{ minHeight: 44 }} onClick={() => setSelected(i.id)}>
            Edit {i.id}
          </button>
          <output aria-label={`Draft ${i.id}`}>{JSON.stringify(i)}</output>
        </section>
      ))}
      <output aria-label="Grading harness notice">{notice}</output>
      {item && (
        <GradingEditor
          item={item}
          itemRef={{ itemId: item.id, itemVersion: item.version, placement: null }}
          ownerEvidence={items}
          onClose={() => setSelected(null)}
          onAcceptDraft={(command) => {
            setItems(items.map((i) => (i.id === command.item.itemId ? { ...i, grading: command.grading } : i)));
            setNotice('Accepted local draft only, not persisted');
          }}
          onCommit={
            sink === 'draft'
              ? undefined
              : async () => {
                  if (sink === 'pending') return new Promise<GradingCommitResult>(() => {});
                  if (sink === 'throw') throw new Error('Synthetic persistence unavailable');
                  if (sink === 'queued') return { kind: 'queued' } as unknown as GradingCommitResult;
                  return { kind: 'rejected', message: 'Synthetic version conflict, draft retained' };
                }
          }
        />
      )}
      <nav
        aria-label="Harness dock"
        style={{
          position: 'fixed',
          zIndex: 45,
          bottom: 'var(--dock-inset)',
          height: 'var(--dock-bar)',
          left: 16,
          right: 16,
          background: 'var(--background)',
          border: '1px solid var(--border)',
          display: 'grid',
        }}
      >
        <button style={{ minHeight: 44 }} onClick={closeAllOverlays}>
          Host tab switch
        </button>
      </nav>
    </main>
  );
}
