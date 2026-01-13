import { useEffect, useRef, useImperativeHandle, forwardRef } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"

export interface TerminalHandle {
  write: (text: string) => void
  clear: () => void
}

interface TerminalProps {
  className?: string
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  function Terminal({ className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const terminalRef = useRef<XTerm | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)

    useEffect(() => {
      if (!containerRef.current) return

      const terminal = new XTerm({
        theme: {
          background: "#0d1117",
          foreground: "#c9d1d9",
          cursor: "#58a6ff",
          cursorAccent: "#0d1117",
          selectionBackground: "#3392ff44",
          black: "#484f58",
          red: "#ff7b72",
          green: "#3fb950",
          yellow: "#d29922",
          blue: "#58a6ff",
          magenta: "#bc8cff",
          cyan: "#39c5cf",
          white: "#b1bac4",
          brightBlack: "#6e7681",
          brightRed: "#ffa198",
          brightGreen: "#56d364",
          brightYellow: "#e3b341",
          brightBlue: "#79c0ff",
          brightMagenta: "#d2a8ff",
          brightCyan: "#56d4dd",
          brightWhite: "#f0f6fc",
        },
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        fontSize: 13,
        lineHeight: 1.2,
        cursorBlink: true,
        scrollback: 10000,
      })

      const fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)

      terminal.open(containerRef.current)
      fitAddon.fit()

      terminalRef.current = terminal
      fitAddonRef.current = fitAddon

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit()
      })
      resizeObserver.observe(containerRef.current)

      return () => {
        resizeObserver.disconnect()
        terminal.dispose()
      }
    }, [])

    useImperativeHandle(ref, () => ({
      write: (text: string) => {
        terminalRef.current?.write(text)
      },
      clear: () => {
        terminalRef.current?.clear()
      },
    }))

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ width: "100%", height: "100%" }}
      />
    )
  }
)
