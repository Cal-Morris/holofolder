"use client"
import { useEffect, useRef, useState } from "react"
import { createBinderRenderer } from "./renderer"
import type { BinderDesign, BinderPart, BinderStats, BinderView, StudioCard } from "@/lib/binder-design"
export interface ViewportProps { compact?: boolean; onPageTurn?: (direction: -1 | 1) => void; design: BinderDesign; cards: readonly StudioCard[]; stats: BinderStats; page: number; artwork: Record<string,string>; view: BinderView; onSelect: (part: BinderPart) => void; onThumbnails: (images:string[])=>void }
export default function BinderViewport(props: ViewportProps) {
  const stage=useRef<HTMLDivElement>(null),engine=useRef<ReturnType<typeof createBinderRenderer>|null>(null),callbacks=useRef(props)
  const [error,setError]=useState(""),compact=Boolean(props.compact)
  useEffect(()=>{callbacks.current=props})
  useEffect(()=>{
    try {engine.current=createBinderRenderer(stage.current!,p=>callbacks.current.onSelect(p),t=>callbacks.current.onThumbnails(t),setError,!compact,direction=>callbacks.current.onPageTurn?.(direction))} catch {queueMicrotask(()=>setError("Your browser cannot open the 3D preview. All appearance controls and device saving remain available."))}
    return ()=>{engine.current?.dispose();engine.current=null}
  },[compact])
  const {design,cards,stats,page,artwork}=props
  useEffect(()=>{engine.current?.update({design,cards,stats,page,artwork})},[design,cards,stats,page,artwork,compact])
  useEffect(()=>{engine.current?.setView(props.view)},[props.view])
  return <><div ref={stage} className="studio-stage" data-testid="binder-3d-stage" />{error&&<p role="status" className="studio-error">{compact?"3D preview unavailable. Open Binder Studio to explore the controls.":error}</p>}{!compact&&<div className="studio-stage-actions"><button onClick={()=>engine.current?.reset()}>Reset view</button></div>}</>
}
