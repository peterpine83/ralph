interface ControlsProps {
  paused: boolean
  running: boolean
  stepMode: boolean
  stopping: boolean
  claudeRunning: boolean
  onPause: () => void
  onResume: () => void
  onSetStepMode: (enabled: boolean) => void
  onStop: () => void
}

export function Controls({
  paused,
  running,
  stepMode,
  stopping,
  claudeRunning,
  onPause,
  onResume,
  onSetStepMode,
  onStop,
}: ControlsProps) {
  return (
    <div style={styles.container}>
      {/* Step Mode Toggle */}
      <label style={styles.toggle}>
        <input
          type="checkbox"
          checked={stepMode}
          onChange={(e) => onSetStepMode(e.target.checked)}
          disabled={!running || stopping}
          style={styles.checkbox}
        />
        <span style={styles.toggleLabel}>Step</span>
      </label>

      {/* Pause/Resume Button */}
      {running && !stopping ? (
        paused ? (
          <button style={{ ...styles.button, ...styles.resume }} onClick={onResume}>
            ▶ Resume
          </button>
        ) : (
          <button style={{ ...styles.button, ...styles.pause }} onClick={onPause}>
            ⏸ Pause
          </button>
        )
      ) : null}

      {/* Stop Button */}
      {running ? (
        <button
          style={{ ...styles.button, ...styles.stop, ...(stopping ? styles.stopDisabled : {}) }}
          onClick={onStop}
          disabled={stopping}
        >
          {stopping ? (claudeRunning ? "⏳ Stopping..." : "Finishing...") : "⏹ Stop"}
        </button>
      ) : (
        <span style={styles.status}>Stopped</span>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    cursor: "pointer",
  },
  checkbox: {
    width: "14px",
    height: "14px",
    cursor: "pointer",
  },
  toggleLabel: {
    fontSize: "13px",
    color: "#c9d1d9",
    userSelect: "none",
  },
  button: {
    padding: "8px 16px",
    fontSize: "13px",
    fontWeight: 500,
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  pause: {
    backgroundColor: "#d29922",
    color: "#0d1117",
  },
  resume: {
    backgroundColor: "#3fb950",
    color: "#0d1117",
  },
  stop: {
    backgroundColor: "#f85149",
    color: "#ffffff",
  },
  stopDisabled: {
    backgroundColor: "#8b4645",
    cursor: "not-allowed",
  },
  status: {
    fontSize: "13px",
    color: "#8b949e",
    fontStyle: "italic",
  },
}
