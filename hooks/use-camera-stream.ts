"use client"

import { useEffect, useState, type RefObject } from "react"

export interface CameraStreamState {
  ready: boolean
  error: string | null
  /** The camera was refused or isn't there (as opposed to still starting). */
  unavailable: boolean
}

const IDLE: CameraStreamState = { ready: false, error: null, unavailable: false }

/** A plain-language reason the camera didn't start (iOS reports NotAllowedError when access is off). */
export function describeCameraError(error: unknown) {
  const name = (error as { name?: string } | null)?.name
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access is off. Allow it in Settings to scan."
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found on this device."
  if (name === "NotReadableError") return "The camera is in use by another app."
  return error instanceof Error && error.message ? error.message : "Could not access the camera."
}

/**
 * Starts the back camera into `videoRef` while `active`, and stops it when inactive or unmounted.
 * Shared by the card selector's scanner and Show mode's Scan. `playsInline` + `muted` on the video
 * are what let iOS (including the installed app) play it without going full screen.
 */
export function useCameraStream(active: boolean, videoRef: RefObject<HTMLVideoElement | null>): CameraStreamState {
  const [state, setState] = useState<CameraStreamState>(IDLE)

  useEffect(() => {
    if (!active) return

    let cancelled = false
    let stream: MediaStream | null = null
    const videoElement = videoRef.current

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error("This browser can't open the camera."), { name: "NotFoundError" })
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        if (!cancelled) setState({ ready: true, error: null, unavailable: false })
      } catch (error) {
        if (!cancelled) setState({ ready: false, error: describeCameraError(error), unavailable: true })
      }
    }

    void start()

    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
      if (videoElement) {
        videoElement.srcObject = null
      }
      setState(IDLE)
    }
  }, [active, videoRef])

  return active ? state : IDLE
}
