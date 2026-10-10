"use client"

import Image from "next/image"
import { BINDER_DESIGN_PRESETS } from "@/lib/binder-design-presets"
import styles from "@/components/binder-preset-picker.module.css"

export function BinderPresetPicker({ active, disabled, onSelect }: { active?: string | null; disabled?: boolean; onSelect: (id: string) => void }) {
  return <div className={styles.picker} role="group" aria-label="Binder appearance presets">
    {BINDER_DESIGN_PRESETS.map(preset => <button className={styles.preset} key={preset.id} type="button" disabled={disabled} aria-label={`Apply ${preset.name} preset`} aria-pressed={active === preset.id} onClick={() => onSelect(preset.id)}>
      <Image src={`/binder-presets/${preset.id}.png`} alt="" width={360} height={280} unoptimized loading="lazy" />
      <span>{preset.name}</span>
    </button>)}
  </div>
}
