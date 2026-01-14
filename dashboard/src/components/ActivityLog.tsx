import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from "react"
import type { ClaudeEvent, ClaudeMessageEvent, ClaudeResultEvent, ClaudeInitEvent } from "../types"

export interface ActivityLogHandle {
  addEvent: (event: ClaudeEvent) => void
  clear: () => void
}

// Processed display item derived from events
interface DisplayItem {
  id: string
  type: "init" | "thinking" | "text" | "tool_use" | "result"
  timestamp: number
  content: string
  expanded: boolean
  details?: string
  isError?: boolean
  toolName?: string
  toolInput?: Record<string, unknown>
}

export const ActivityLog = forwardRef<ActivityLogHandle>(
  function ActivityLog(_, ref) {
    const [items, setItems] = useState<DisplayItem[]>([])
    const [autoScroll, setAutoScroll] = useState(true)
    const containerRef = useRef<HTMLDivElement>(null)
    const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    // Process an event into display items
    const processEvent = useCallback((event: ClaudeEvent): DisplayItem[] => {
      const timestamp = Date.now()
      const results: DisplayItem[] = []

      if (event.type === "system" && (event as ClaudeInitEvent).subtype === "init") {
        const initEvent = event as ClaudeInitEvent
        results.push({
          id: `init-${timestamp}`,
          type: "init",
          timestamp,
          content: "Session started",
          expanded: false,
          details: `Session ID: ${initEvent.session_id}\nTools: ${initEvent.tools?.length || 0}`,
        })
      } else if (event.type === "assistant") {
        const msgEvent = event as ClaudeMessageEvent
        const content = msgEvent.message?.content || []

        for (const block of content) {
          const blockId = `${block.type}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`

          if (block.type === "thinking" && block.thinking) {
            results.push({
              id: blockId,
              type: "thinking",
              timestamp,
              content: truncateText(block.thinking, 100),
              expanded: false,
              details: block.thinking,
            })
          } else if (block.type === "text" && block.text) {
            results.push({
              id: blockId,
              type: "text",
              timestamp,
              content: block.text,
              expanded: true,
            })
          } else if (block.type === "tool_use" && block.name) {
            results.push({
              id: blockId,
              type: "tool_use",
              timestamp,
              content: block.name,
              expanded: false,
              toolName: block.name,
              toolInput: block.input,
              details: JSON.stringify(block.input, null, 2),
            })
          }
        }
      } else if (event.type === "result") {
        const resultEvent = event as ClaudeResultEvent
        results.push({
          id: `result-${timestamp}`,
          type: "result",
          timestamp,
          content: resultEvent.subtype === "success" ? "Completed" : "Error",
          expanded: false,
          isError: resultEvent.subtype === "error",
          details: resultEvent.duration_ms
            ? `Duration: ${(resultEvent.duration_ms / 1000).toFixed(1)}s\nCost: $${resultEvent.cost_usd?.toFixed(4) || "0.00"}`
            : undefined,
        })
      }

      return results
    }, [])

    // Add an event
    const addEvent = useCallback((event: ClaudeEvent) => {
      const newItems = processEvent(event)
      if (newItems.length > 0) {
        setItems(prev => [...prev, ...newItems])
      }
    }, [processEvent])

    // Clear all items
    const clear = useCallback(() => {
      setItems([])
    }, [])

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      addEvent,
      clear,
    }))

    // Auto-scroll effect
    useEffect(() => {
      if (autoScroll && containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight
      }
    }, [items, autoScroll])

    // Handle scroll to detect user scrolling up
    const handleScroll = useCallback(() => {
      if (!containerRef.current) return

      const { scrollTop, scrollHeight, clientHeight } = containerRef.current
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50

      if (isAtBottom) {
        setAutoScroll(true)
      } else {
        setAutoScroll(false)
      }

      // Clear any existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }, [])

    // Toggle item expansion
    const toggleExpanded = useCallback((id: string) => {
      setItems(prev =>
        prev.map(item =>
          item.id === id ? { ...item, expanded: !item.expanded } : item
        )
      )
    }, [])

    return (
      <div style={styles.container}>
        <div
          ref={containerRef}
          style={styles.scrollContainer}
          onScroll={handleScroll}
        >
          {items.length === 0 ? (
            <div style={styles.empty}>Waiting for events...</div>
          ) : (
            items.map(item => (
              <LogItem
                key={item.id}
                item={item}
                onToggle={() => toggleExpanded(item.id)}
              />
            ))
          )}
        </div>
        {!autoScroll && (
          <button
            style={styles.scrollButton}
            onClick={() => {
              setAutoScroll(true)
              if (containerRef.current) {
                containerRef.current.scrollTop = containerRef.current.scrollHeight
              }
            }}
          >
            Scroll to bottom
          </button>
        )}
      </div>
    )
  }
)

// Individual log item component
function LogItem({
  item,
  onToggle,
}: {
  item: DisplayItem
  onToggle: () => void
}) {
  const hasDetails = item.details && item.type !== "text"
  const isExpandable = hasDetails || item.type === "thinking"

  return (
    <div style={styles.item}>
      <div
        style={{
          ...styles.itemHeader,
          cursor: isExpandable ? "pointer" : "default",
        }}
        onClick={isExpandable ? onToggle : undefined}
      >
        <span style={styles.itemIcon}>
          {getIcon(item.type, item.expanded, item.isError)}
        </span>
        <span style={getContentStyle(item.type, item.isError)}>
          {getLabel(item)}
        </span>
        <span style={styles.timestamp}>
          {formatTime(item.timestamp)}
        </span>
      </div>

      {/* Expanded content */}
      {item.expanded && item.type === "text" && (
        <div style={styles.textContent}>
          {item.content}
        </div>
      )}

      {item.expanded && item.type === "thinking" && item.details && (
        <div style={styles.thinkingContent}>
          {item.details}
        </div>
      )}

      {item.expanded && item.type === "tool_use" && item.details && (
        <div style={styles.codeContent}>
          <pre style={styles.pre}>{item.details}</pre>
        </div>
      )}

      {item.expanded && item.type === "result" && item.details && (
        <div style={styles.resultContent}>
          {item.details}
        </div>
      )}

      {item.expanded && item.type === "init" && item.details && (
        <div style={styles.resultContent}>
          {item.details}
        </div>
      )}
    </div>
  )
}

// Helper functions
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + "..."
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function getIcon(type: DisplayItem["type"], expanded: boolean, isError?: boolean): string {
  if (type === "init") return "\u25cf"  // Filled circle
  if (type === "result") return isError ? "\u2717" : "\u2713"  // X or checkmark
  if (type === "thinking") return expanded ? "\u25bc" : "\u25b6"  // Down or right triangle
  if (type === "text") return "\u25cb"  // Empty circle
  if (type === "tool_use") return expanded ? "\u25bc" : "\u25b6"  // Down or right triangle
  return "\u25cb"
}

function getLabel(item: DisplayItem): string {
  switch (item.type) {
    case "init":
      return item.content
    case "thinking":
      return `Thinking: ${item.content}`
    case "text":
      return "Claude response"
    case "tool_use":
      return `Tool: ${item.toolName}`
    case "result":
      return item.content
    default:
      return item.content
  }
}

function getContentStyle(type: DisplayItem["type"], isError?: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    flex: 1,
    fontSize: "13px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }

  if (type === "thinking") {
    return { ...base, color: "#8b949e", fontStyle: "italic" }
  }
  if (type === "result" && isError) {
    return { ...base, color: "#ff7b72" }
  }
  if (type === "result") {
    return { ...base, color: "#3fb950" }
  }
  if (type === "tool_use") {
    return { ...base, color: "#58a6ff" }
  }
  return { ...base, color: "#c9d1d9" }
}

// Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    position: "relative",
  },
  scrollContainer: {
    flex: 1,
    overflow: "auto",
    padding: "8px 0",
  },
  empty: {
    color: "#8b949e",
    fontSize: "13px",
    textAlign: "center",
    padding: "20px",
  },
  item: {
    marginBottom: "4px",
  },
  itemHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 12px",
    borderRadius: "4px",
    backgroundColor: "transparent",
    transition: "background-color 0.15s",
  },
  itemIcon: {
    fontSize: "10px",
    width: "16px",
    textAlign: "center",
    color: "#8b949e",
    flexShrink: 0,
  },
  timestamp: {
    fontSize: "11px",
    color: "#6e7681",
    fontFamily: "Menlo, Monaco, monospace",
    flexShrink: 0,
  },
  textContent: {
    marginLeft: "36px",
    marginTop: "4px",
    padding: "8px 12px",
    backgroundColor: "#161b22",
    borderRadius: "4px",
    fontSize: "13px",
    color: "#c9d1d9",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    lineHeight: 1.5,
  },
  thinkingContent: {
    marginLeft: "36px",
    marginTop: "4px",
    padding: "8px 12px",
    backgroundColor: "#161b22",
    borderRadius: "4px",
    fontSize: "12px",
    color: "#8b949e",
    fontStyle: "italic",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    lineHeight: 1.4,
    maxHeight: "200px",
    overflow: "auto",
  },
  codeContent: {
    marginLeft: "36px",
    marginTop: "4px",
    padding: "8px 12px",
    backgroundColor: "#161b22",
    borderRadius: "4px",
    overflow: "auto",
    maxHeight: "300px",
  },
  pre: {
    margin: 0,
    fontSize: "12px",
    fontFamily: "Menlo, Monaco, monospace",
    color: "#79c0ff",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  resultContent: {
    marginLeft: "36px",
    marginTop: "4px",
    padding: "8px 12px",
    backgroundColor: "#161b22",
    borderRadius: "4px",
    fontSize: "12px",
    color: "#8b949e",
    whiteSpace: "pre-wrap",
  },
  scrollButton: {
    position: "absolute",
    bottom: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "6px 12px",
    backgroundColor: "#238636",
    color: "#ffffff",
    border: "none",
    borderRadius: "4px",
    fontSize: "12px",
    cursor: "pointer",
  },
}
