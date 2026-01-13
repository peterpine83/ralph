import { useState, useRef, useCallback } from "react"
import { useSSE } from "./hooks/useSSE"
import { Terminal, type TerminalHandle } from "./components/Terminal"
import { FeatureList } from "./components/FeatureList"
import { Controls } from "./components/Controls"
import type { Feature, DashboardEvent, StateData, IterationData } from "./types"

function App() {
  const terminalRef = useRef<TerminalHandle>(null)
  const [state, setState] = useState<StateData>({
    paused: false,
    running: false,
    containerName: "",
    branch: "",
  })
  const [iteration, setIteration] = useState<IterationData>({
    current: 0,
    max: 5,
    remaining: 0,
  })
  const [features, setFeatures] = useState<Feature[]>([])

  const handleEvent = useCallback((event: DashboardEvent) => {
    switch (event.type) {
      case "state":
        setState(event.data)
        break
      case "iteration":
        setIteration(event.data)
        break
      case "features":
        setFeatures(event.data.features)
        break
      case "output":
        terminalRef.current?.write(event.data.text)
        break
    }
  }, [])

  const { pause, resume } = useSSE(handleEvent)

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.title}>
          <span style={styles.logo}>🐶</span>
          <span>Ralph Dashboard</span>
        </div>
        <div style={styles.status}>
          <span style={styles.statusItem}>
            <span style={styles.label}>Branch:</span>
            <span style={styles.value}>{state.branch || "—"}</span>
          </span>
          <span style={styles.statusItem}>
            <span style={styles.label}>Iteration:</span>
            <span style={styles.value}>{iteration.current}/{iteration.max}</span>
          </span>
          <span style={styles.statusItem}>
            <span style={styles.label}>Remaining:</span>
            <span style={styles.value}>{iteration.remaining}</span>
          </span>
        </div>
        <Controls
          paused={state.paused}
          running={state.running}
          onPause={pause}
          onResume={resume}
        />
      </header>

      {/* Main content */}
      <div style={styles.main}>
        {/* Left panel: Features */}
        <div style={styles.sidebar}>
          <div style={styles.panelHeader}>Features</div>
          <div style={styles.panelContent}>
            <FeatureList features={features} />
          </div>
        </div>

        {/* Right panel: Terminal */}
        <div style={styles.terminal}>
          <div style={styles.panelHeader}>Claude Output</div>
          <div style={styles.terminalContent}>
            <Terminal ref={terminalRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    backgroundColor: "#0d1117",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 20px",
    borderBottom: "1px solid #21262d",
    backgroundColor: "#161b22",
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "16px",
    fontWeight: 600,
    color: "#f0f6fc",
  },
  logo: {
    fontSize: "20px",
  },
  status: {
    display: "flex",
    gap: "24px",
  },
  statusItem: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  label: {
    fontSize: "12px",
    color: "#8b949e",
  },
  value: {
    fontSize: "13px",
    color: "#c9d1d9",
    fontFamily: "Menlo, Monaco, monospace",
  },
  main: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  sidebar: {
    width: "320px",
    borderRight: "1px solid #21262d",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
  },
  terminal: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  panelHeader: {
    padding: "12px 16px",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: "#8b949e",
    borderBottom: "1px solid #21262d",
    backgroundColor: "#161b22",
  },
  panelContent: {
    padding: "12px",
    overflow: "auto",
    flex: 1,
  },
  terminalContent: {
    flex: 1,
    padding: "8px",
    overflow: "hidden",
  },
}

export default App
