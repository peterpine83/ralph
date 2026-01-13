interface ControlsProps {
  paused: boolean
  running: boolean
  onPause: () => void
  onResume: () => void
}

export function Controls({ paused, running, onPause, onResume }: ControlsProps) {
  return (
    <div style={styles.container}>
      {running ? (
        paused ? (
          <button style={{ ...styles.button, ...styles.resume }} onClick={onResume}>
            ▶ Resume
          </button>
        ) : (
          <button style={{ ...styles.button, ...styles.pause }} onClick={onPause}>
            ⏸ Pause
          </button>
        )
      ) : (
        <span style={styles.status}>
          {paused ? "Paused" : "Stopped"}
        </span>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
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
  status: {
    fontSize: "13px",
    color: "#8b949e",
    fontStyle: "italic",
  },
}
