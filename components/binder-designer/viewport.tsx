"use client"
import { useEffect, useRef, useState } from "react"
import { createBinderRenderer } from "./renderer"
import type { BinderDesign, BinderPart, BinderStats, BinderView, StudioCard } from "@/lib/binder-design"
import styles from "./viewport.module.css"
export interface ViewportProps { compact?: boolean; onSlotSelect?: (slot: number) => void; onPageTurn?: (direction: -1 | 1) => void; design: BinderDesign; cards: readonly StudioCard[]; stats: BinderStats; page: number; artwork: Record<string,string>; view: BinderView; onSelect: (part: BinderPart) => void }
export default function BinderViewport(props: ViewportProps) {
  const stage=useRef<HTMLDivElement>(null),engine=useRef<ReturnType<typeof createBinderRenderer>|null>(null),callbacks=useRef(props)
  const [error,setError]=useState(""),compact=Boolean(props.compact)
  useEffect(()=>{callbacks.current=props})
  useEffect(()=>{
    try {engine.current=createBinderRenderer(stage.current!,p=>callbacks.current.onSelect(p),setError,direction=>callbacks.current.onPageTurn?.(direction),callbacks.current.onSlotSelect?slot=>callbacks.current.onSlotSelect?.(slot):undefined)} catch {queueMicrotask(()=>setError("Your browser cannot open the 3D preview. All appearance controls and device saving remain available."))}
    return ()=>{engine.current?.dispose();engine.current=null}
  },[compact])
  const {design,cards,stats,page,artwork}=props
  useEffect(()=>{engine.current?.update({design,cards,stats,page,artwork})},[design,cards,stats,page,artwork,compact])
  useEffect(()=>{engine.current?.setView(props.view)},[props.view])
  return <><div className={styles.viewport} role="group" aria-label="Interactive 3D binder" tabIndex={0} aria-keyshortcuts="ArrowLeft ArrowRight Home" onKeyDown={event=>{
    if(event.target!==event.currentTarget||event.altKey||event.ctrlKey||event.metaKey)return
    if(event.key==="Home"){event.preventDefault();engine.current?.reset()}
    if(props.view==="inside"&&props.onPageTurn&&(event.key==="ArrowLeft"||event.key==="ArrowRight")){event.preventDefault();props.onPageTurn(event.key==="ArrowLeft"?-1:1)}
  }}><div ref={stage} className="studio-stage" data-testid="binder-3d-stage" />{(!compact||props.onSlotSelect)&&!error&&<button type="button" className={styles.fit} aria-label="Fit binder" title="Fit binder" onClick={()=>engine.current?.reset()}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></button>}</div>{error&&<p role="status" className="studio-error">{compact?"3D preview unavailable. Open Binder Studio to explore the controls.":error}</p>}</>
}
