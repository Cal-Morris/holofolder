"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react"
import { FEATURED_CARDS, getFeaturedCardImageUrl } from "@/lib/featured-cards"
import styles from "@/components/home-page.module.css"

const cards = FEATURED_CARDS.slice(0, 6)

export function MarketingCardFan() {
  const stage = useRef<HTMLDivElement>(null)
  const fan = useRef<HTMLDivElement>(null)
  const deck = useRef<HTMLDivElement>(null)
  const cardElements = useRef(new Map<string, HTMLDivElement>())
  const animations = useRef<Animation[]>([])
  const currentIndex = useRef(0)
  const pose = useRef({ x: 0, y: 0, gather: 0 })
  const shuffle = useRef<{ transforms: Map<string, string>; lifted: string } | null>(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [visible, setVisible] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(true)
  const [hidden, setHidden] = useState(false)

  const move = useCallback((direction: number, animate = true) => {
    const previous = currentIndex.current
    const next = (previous + direction + cards.length) % cards.length
    const transforms = new Map(Array.from(cardElements.current, ([id, element]) => [id, getComputedStyle(element).transform]))
    animations.current.forEach((animation) => animation.cancel())
    animations.current = []
    shuffle.current = animate && !reducedMotion && !paused
      ? { transforms, lifted: cards[direction > 0 ? previous : next].id }
      : null
    currentIndex.current = next
    setIndex(next)
  }, [reducedMotion, paused])

  useLayoutEffect(() => {
    const pending = shuffle.current
    if (!pending) return
    shuffle.current = null
    for (const [id, element] of cardElements.current) {
      const target = getComputedStyle(element)
      const from = pending.transforms.get(id)!
      const to = target.transform
      const zIndex = target.zIndex
      const keyframes: Keyframe[] = id === pending.lifted
        ? [
          { transform: from, zIndex: 7 },
          { transform: "translateX(-35%) translateY(-24px) rotate(28deg) translateZ(45px)", zIndex: 7, offset: .42 },
          { transform: to, zIndex },
        ]
        : [{ transform: from }, { transform: to }]
      animations.current.push(element.animate(keyframes, {
        duration: id === pending.lifted ? 420 : 340,
        easing: "cubic-bezier(.23, 1, .32, 1)",
      }))
    }
  }, [index])

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updateMotion = () => setReducedMotion(motion.matches)
    const updateVisibility = () => setHidden(document.hidden)
    updateMotion()
    updateVisibility()
    motion.addEventListener("change", updateMotion)
    document.addEventListener("visibilitychange", updateVisibility)
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    if (stage.current) observer.observe(stage.current)
    return () => {
      observer.disconnect()
      motion.removeEventListener("change", updateMotion)
      document.removeEventListener("visibilitychange", updateVisibility)
      animations.current.forEach((animation) => animation.cancel())
    }
  }, [])

  useEffect(() => {
    for (const animation of animations.current) {
      if (reducedMotion) animation.cancel()
      else if ((paused || hidden || !visible) && animation.playState === "running") animation.pause()
      else if (animation.playState === "paused") animation.play()
    }
  }, [paused, hidden, visible, reducedMotion])

  useEffect(() => {
    if (paused || hovered || focused || !visible || hidden || reducedMotion) return
    const timer = window.setTimeout(() => move(1), 4500)
    return () => window.clearTimeout(timer)
  }, [index, paused, hovered, focused, visible, hidden, reducedMotion, move])

  useEffect(() => {
    const surface = fan.current
    const stack = deck.current
    if (!surface || !stack) return
    if (reducedMotion) {
      stack.style.transform = ""
      stack.style.setProperty("--fan-spread", "1")
      pose.current = { x: 0, y: 0, gather: 0 }
      return
    }
    if (paused || hidden || !visible) return
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)")
    let { x, y, gather } = pose.current
    let targetX = 0, targetY = 0, targetGather = gather
    let frame = 0
    const paint = () => {
      x += (targetX - x) * .14
      y += (targetY - y) * .14
      gather += (targetGather - gather) * .14
      pose.current = { x, y, gather }
      stack.style.transform = `translate3d(${gather * surface.clientWidth * .07}px, ${gather * surface.clientHeight * .12}px, 0) scale(${1 - gather * .18}) rotateX(${-y * 4}deg) rotateY(${x * 5}deg)`
      stack.style.setProperty("--fan-spread", String(1 - gather * .72))
      frame = Math.abs(targetX - x) + Math.abs(targetY - y) + Math.abs(targetGather - gather) > .002
        ? requestAnimationFrame(paint) : 0
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint) }
    const pointer = (event: PointerEvent) => {
      if (!finePointer.matches || event.pointerType !== "mouse") return
      const bounds = surface.getBoundingClientRect()
      targetX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1))
      targetY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1))
      schedule()
    }
    const leave = () => { targetX = targetY = 0; schedule() }
    const scroll = () => {
      const bounds = surface.getBoundingClientRect()
      targetGather = Math.max(0, Math.min(1, (innerHeight * .42 - bounds.top) / bounds.height))
      schedule()
    }
    surface.addEventListener("pointermove", pointer)
    surface.addEventListener("pointerleave", leave)
    window.addEventListener("scroll", scroll, { passive: true })
    window.addEventListener("resize", scroll)
    scroll()
    return () => {
      cancelAnimationFrame(frame)
      surface.removeEventListener("pointermove", pointer)
      surface.removeEventListener("pointerleave", leave)
      window.removeEventListener("scroll", scroll)
      window.removeEventListener("resize", scroll)
    }
  }, [paused, reducedMotion, hidden, visible])

  const current = cards[index]
  return (
    <div
      ref={stage}
      className={styles.cardShowcase}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
      role="region"
      aria-label="Featured Pokémon cards"
    >
      <div ref={fan} className={styles.fan} data-testid="featured-card-stage">
        <div ref={deck} className={styles.fanDeck}>
          {cards.map((card, cardIndex) => {
            const position = (cardIndex - index + cards.length) % cards.length
            return (
              <div
                key={card.id}
                ref={(element) => {
                  if (element) cardElements.current.set(card.id, element)
                  else cardElements.current.delete(card.id)
                }}
                className={`trading-card ${styles.cardFace} ${styles.fanCard}`}
                data-card-id={card.id}
                data-position={position}
              >
                {/* Native images preserve the full scan and use the app's image mirror. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={getFeaturedCardImageUrl(card)} alt={position === 0 ? `${card.name}, ${card.set}, ${card.num}` : ""} width={630} height={880} fetchPriority={cardIndex === 0 ? "high" : "auto"} />
              </div>
            )
          })}
        </div>
      </div>
      <div className={styles.cardCaption}>
        <p data-testid="featured-card-name">{current.name}</p>
        <p>{current.set} · {current.num}</p>
      </div>
      <div className={styles.cycleControls}>
        <button type="button" aria-label="Previous featured card" onClick={(event) => move(-1, event.detail !== 0)}><ArrowLeft size={16} /></button>
        <span className={styles.counter}>{index + 1} / {cards.length}</span>
        <button type="button" aria-label="Next featured card" onClick={(event) => move(1, event.detail !== 0)}><ArrowRight size={16} /></button>
        <button type="button" aria-label={paused ? "Play featured cards" : "Pause featured cards"} aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? "Play" : "Pause"}</button>
      </div>
    </div>
  )
}
