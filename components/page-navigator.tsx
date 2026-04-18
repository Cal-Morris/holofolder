"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface PageNavigatorProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export default function PageNavigator({ currentPage, totalPages, onPageChange }: PageNavigatorProps) {
  const [jumpValue, setJumpValue] = useState("")
  const [showJump, setShowJump] = useState(false)

  const handleJump = () => {
    const page = parseInt(jumpValue)
    if (page >= 1 && page <= totalPages) {
      onPageChange(page)
      setJumpValue("")
      setShowJump(false)
    }
  }

  const getVisiblePages = () => {
    const pages: (number | string)[] = []
    const showEllipsis = totalPages > 7

    if (!showEllipsis) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
      return pages
    }

    pages.push(1)

    if (currentPage > 3) pages.push("...")

    const start = Math.max(2, currentPage - 1)
    const end = Math.min(totalPages - 1, currentPage + 1)

    for (let i = start; i <= end; i++) {
      if (!pages.includes(i)) pages.push(i)
    }

    if (currentPage < totalPages - 2) pages.push("...")
    
    if (!pages.includes(totalPages)) pages.push(totalPages)

    return pages
  }

  return (
    <div className="flex items-center justify-center gap-1 flex-wrap">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onPageChange(1)}
        disabled={currentPage === 1}
        className="hidden sm:flex"
      >
        <ChevronsLeft className="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>

      <div className="flex items-center gap-1">
        {getVisiblePages().map((page, idx) =>
          page === "..." ? (
            <button
              key={`ellipsis-${idx}`}
              onClick={() => setShowJump(!showJump)}
              className="w-8 h-8 text-muted-foreground hover:text-foreground transition-colors"
            >
              ...
            </button>
          ) : (
            <Button
              key={page}
              variant={currentPage === page ? "default" : "ghost"}
              size="sm"
              onClick={() => onPageChange(page as number)}
              className="w-8 h-8 p-0"
            >
              {page}
            </Button>
          )
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
      >
        <ChevronRight className="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onPageChange(totalPages)}
        disabled={currentPage === totalPages}
        className="hidden sm:flex"
      >
        <ChevronsRight className="w-4 h-4" />
      </Button>

      {showJump && (
        <div className="flex items-center gap-1 ml-2">
          <Input
            type="number"
            min={1}
            max={totalPages}
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJump()}
            placeholder="Page"
            className="w-16 h-8 text-sm"
          />
          <Button size="sm" onClick={handleJump} className="h-8">
            Go
          </Button>
        </div>
      )}
    </div>
  )
}
