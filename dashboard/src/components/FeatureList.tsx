import type { Feature } from "../types"

interface FeatureListProps {
  features: Feature[]
}

export function FeatureList({ features }: FeatureListProps) {
  if (features.length === 0) {
    return (
      <div style={styles.empty}>
        No features loaded
      </div>
    )
  }

  return (
    <div style={styles.container}>
      {features.map((feature) => (
        <div key={feature.id} style={styles.item}>
          <span style={styles.icon}>
            {feature.passes ? "✓" : "○"}
          </span>
          <div style={styles.content}>
            <span style={{
              ...styles.id,
              ...(feature.passes ? styles.passed : {}),
            }}>
              {feature.id}
            </span>
            <span style={styles.description}>
              {feature.description}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  empty: {
    color: "#8b949e",
    fontStyle: "italic",
    padding: "16px",
  },
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    padding: "8px",
    borderRadius: "6px",
    backgroundColor: "#161b22",
  },
  icon: {
    fontSize: "14px",
    lineHeight: "20px",
    color: "#3fb950",
    flexShrink: 0,
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  id: {
    fontSize: "13px",
    fontWeight: 500,
    color: "#c9d1d9",
  },
  passed: {
    textDecoration: "line-through",
    color: "#8b949e",
  },
  description: {
    fontSize: "12px",
    color: "#8b949e",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
}
