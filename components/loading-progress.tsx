"use client"

import { usePokemonCache } from "@/hooks/use-pokemon-cache"

export default function LoadingProgress() {
  const { isLoading, progress } = usePokemonCache()

  if (!isLoading) {
    return null
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      <div className="h-1 bg-muted overflow-hidden">
        <div className="h-full bg-primary animate-pulse w-full" />
      </div>
    </div>
  )
}
