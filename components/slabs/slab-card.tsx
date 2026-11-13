'use client';

import { useState } from 'react';
import CardImage from '@/components/card-image';
import type { SlabPresentation } from '@/lib/slabs/presentation';
import { slabSummary } from '@/lib/slabs/presentation';
import styles from './slabs.module.css';

function CardWindow({ slab, sizes }: { slab: SlabPresentation; sizes: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className={styles.window}>
      {slab.image && failed !== slab.image ? (
        <CardImage
          src={slab.image}
          alt={slab.name}
          sizes={sizes}
          fill
          loading="lazy"
          className={styles.image}
          onError={() => setFailed(slab.image)}
        />
      ) : (
        <div className={styles.noImage}>
          <strong>{slab.name}</strong>
          <span>Card image unavailable</span>
        </div>
      )}
    </div>
  );
}
function Description({ slab }: { slab: SlabPresentation }) {
  return (
    <div className={styles.labelDescription}>
      <strong>{slab.name}</strong>
      <span>
        {slab.set ?? 'Set unknown'}
        {slab.number ? ` #${slab.number}` : ''}
      </span>
    </div>
  );
}
function Grade({ slab }: { slab: SlabPresentation }) {
  return (
    <div className={styles.grade}>
      <span>{slab.designation}</span>
      <strong>{slab.grade ?? '?'}</strong>
    </div>
  );
}
function Subgrades({ slab }: { slab: SlabPresentation }) {
  return (
    <div className={styles.subgrades}>
      {slab.subgrades.length ? (
        slab.subgrades.map((s) => (
          <span key={s.name}>
            {s.name} <b>{s.grade}</b>
          </span>
        ))
      ) : (
        <span>Subgrades unknown</span>
      )}
    </div>
  );
}
function PSALabel({ slab }: { slab: SlabPresentation }) {
  return (
    <div className={styles.psaLabel}>
      <Description slab={slab} />
      <Grade slab={slab} />
      <span className={styles.psaWord}>PSA</span>
    </div>
  );
}
function CGCLabel({ slab }: { slab: SlabPresentation }) {
  const legacy = slab.holder === 'cgc-2020';
  return (
    <div className={legacy ? styles.cgcBlueLabel : styles.cgcLabel}>
      <div className={styles.cgcMasthead}>
        <b>CGC</b>
        <span>{legacy ? 'UNIVERSAL GRADE' : 'CERTIFIED GUARANTY COMPANY'}</span>
      </div>
      <div className={styles.cgcDescription}>
        <Description slab={slab} />
        <Grade slab={slab} />
      </div>
      {legacy && <Subgrades slab={slab} />}
    </div>
  );
}
function BeckettLabel({ slab }: { slab: SlabPresentation }) {
  return (
    <div className={styles.beckettLabel}>
      <strong className={styles.beckettWord}>Beckett</strong>
      <div className={styles.beckettTop}>
        <Description slab={slab} />
        <Grade slab={slab} />
      </div>
      <Subgrades slab={slab} />
    </div>
  );
}
function NeutralLabel({ slab }: { slab: SlabPresentation }) {
  return (
    <div className={styles.neutralLabel}>
      <b>{slab.provider}</b>
      <Grade slab={slab} />
      <span>{slab.note}</span>
    </div>
  );
}
/** Static structure with catalog artwork kept separate. Never receives a private GradingRecord. */
export default function SlabCard({
  slab,
  sizes = '(max-width: 639px) 44vw, 220px',
}: {
  slab: SlabPresentation;
  sizes?: string;
}) {
  return (
    <div
      className={styles.slab}
      data-slab-style={slab.style}
      data-holder={slab.holder}
      data-label-tint={slab.tint}
      role="img"
      aria-label={`${slab.name}, ${slabSummary(slab)}`}
    >
      <div className={styles.case} aria-hidden="true">
        {slab.style !== 'raw' && (
          <div className={styles.label}>
            {slab.style === 'psa-lighthouse' ? (
              <PSALabel slab={slab} />
            ) : slab.style.startsWith('cgc-') ? (
              <CGCLabel slab={slab} />
            ) : slab.style.startsWith('beckett-') ? (
              <BeckettLabel slab={slab} />
            ) : (
              <NeutralLabel slab={slab} />
            )}
          </div>
        )}
        <CardWindow slab={slab} sizes={sizes} />
      </div>
    </div>
  );
}
