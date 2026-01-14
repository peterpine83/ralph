import { useEffect, useRef, useCallback } from "react"
import type { DashboardEvent } from "../types"

export function useSSE(onEvent: (event: DashboardEvent) => void) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const onEventRef = useRef(onEvent)

  // Keep callback ref up to date
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    const eventSource = new EventSource("/events")
    eventSourceRef.current = eventSource

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DashboardEvent
        onEventRef.current(data)
      } catch {
        // Ignore parse errors
      }
    }

    eventSource.onerror = () => {
      // Reconnect on error
      eventSource.close()
      setTimeout(() => {
        eventSourceRef.current = new EventSource("/events")
      }, 1000)
    }

    return () => {
      eventSource.close()
    }
  }, [])

  const pause = useCallback(async () => {
    await fetch("/pause", { method: "POST" })
  }, [])

  const resume = useCallback(async () => {
    await fetch("/resume", { method: "POST" })
  }, [])

  const setStepMode = useCallback(async (enabled: boolean) => {
    await fetch("/step-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    })
  }, [])

  const stop = useCallback(async () => {
    await fetch("/stop", { method: "POST" })
  }, [])

  return { pause, resume, setStepMode, stop }
}
