"use client"

import { Card } from "@/components/ui/card"

interface BinderPositionProps {
  dexNumber: number
  onSlotClick: (slot: { page: number; slot: string }) => void
}

export default function BinderPosition({ dexNumber, onSlotClick }: BinderPositionProps) {
  // Calculate binder position: 16 slots per page (4 columns × 4 rows)
  const slotsPerPage = 16
  const pageNumber = Math.ceil(dexNumber / slotsPerPage)
  const positionInPage = ((dexNumber - 1) % slotsPerPage) + 1

  // Convert position to row and column (0-indexed internally)
  const row = Math.floor((positionInPage - 1) / 4)
  const col = (positionInPage - 1) % 4

  // Create a visual grid showing the position
  const slotPositions = Array.from({ length: 16 }, (_, i) => i + 1)

  const getSlotLabel = (slot: number): string => {
    const r = Math.floor((slot - 1) / 4)
    const c = (slot - 1) % 4
    return `${String.fromCharCode(65 + r)}${c + 1}`
  }

  return (
    <Card className="border-2 border-primary/20">
      <div className="bg-gradient-to-r from-primary to-accent p-4 text-primary-foreground">
        <h3 className="text-xl font-bold">
          Page {pageNumber} • Slot {getSlotLabel(positionInPage)}
        </h3>
      </div>

      <div className="p-6">
        {/* Visual Grid */}
        <div className="grid grid-cols-4 gap-2">
          {slotPositions.map((slot) => (
            <button
              key={slot}
              onClick={() => onSlotClick({ page: pageNumber, slot: getSlotLabel(slot) })}
              className={`aspect-square rounded-lg border-2 flex items-center justify-center font-bold transition-all cursor-pointer hover:scale-105 ${
                slot === positionInPage
                  ? "bg-primary text-primary-foreground border-primary shadow-lg"
                  : "bg-muted border-border text-muted-foreground hover:bg-primary/10"
              }`}
            >
              {getSlotLabel(slot)}
            </button>
          ))}
        </div>
      </div>
    </Card>
  )
}
