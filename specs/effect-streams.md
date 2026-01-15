# Effect Streams Specification

**File**: `src/streams/ndjson.ts`
**Purpose**: Parse NDJSON (Newline Delimited JSON) streams from Claude CLI output using Effect Stream

## Overview

Claude CLI with `--output-format stream-json` emits NDJSON - one JSON object per line. The stream module provides type-safe parsing with proper error handling and resource cleanup.

## Current Pattern (Before Effect)

```typescript
// Manual stream handling in ralph.ts
const reader = stream.getReader()
const decoder = new TextDecoder()
let buffer = ""

while (true) {
  const { done, value } = await reader.read()
  if (done) break

  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split("\n")
  buffer = lines.pop() || ""

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as ClaudeEvent
      sendClaudeEvent(event)
    } catch {
      sendOutput(line + "\n")  // Fallback for non-JSON
    }
  }
}
```

**Issues:**
- Manual buffer management
- No guaranteed cleanup (reader.releaseLock)
- Error handling mixed with business logic
- Type safety relies on cast

## Effect Stream Pattern

```typescript
// src/streams/ndjson.ts
import { Stream, Effect } from "effect"
import { StreamError } from "../errors"

export const parseNDJSON = <T>(
  source: Stream.Stream<Uint8Array, StreamError>
): Stream.Stream<T, StreamError> =>
  source.pipe(
    // Decode bytes to text
    Stream.decodeText("utf-8"),

    // Accumulate and split on newlines
    Stream.splitLines,

    // Filter empty lines
    Stream.filter((line) => line.trim().length > 0),

    // Parse JSON with error handling
    Stream.mapEffect((line) =>
      Effect.try({
        try: () => JSON.parse(line) as T,
        catch: (e) => new StreamError({
          message: "Invalid JSON",
          line,
          cause: e
        })
      })
    )
  )
```

## Stream Source Conversion

### From ReadableStream (WHATWG)

```typescript
import { Stream } from "effect"
import { StreamError } from "../errors"

const fromReadableStream = (
  source: ReadableStream<Uint8Array>
): Stream.Stream<Uint8Array, StreamError> =>
  Stream.fromReadableStream(
    () => source,
    (error) => new StreamError({
      message: "ReadableStream error",
      cause: error
    })
  )
```

### From Docker Exec Stdout

```typescript
import { Stream, Effect } from "effect"
import { DockerService } from "../services/Docker"
import type { ClaudeEvent } from "../types"

const streamClaudeEvents = (
  container: string,
  cmd: string[]
): Stream.Stream<ClaudeEvent, DockerError | StreamError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const docker = yield* DockerService
      const { stdout } = yield* docker.execStream(container, cmd)

      return parseNDJSON<ClaudeEvent>(stdout)
    })
  )
```

## Stream Operations

### Filtering by Event Type

```typescript
const assistantMessages = parseNDJSON<ClaudeEvent>(stdout).pipe(
  Stream.filter((event): event is ClaudeMessageEvent =>
    event.type === "assistant"
  )
)
```

### Extracting Text Content

```typescript
const textContent = parseNDJSON<ClaudeEvent>(stdout).pipe(
  Stream.filter((event): event is ClaudeMessageEvent =>
    event.type === "assistant"
  ),
  Stream.flatMap((event) =>
    Stream.fromIterable(
      event.message.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
    )
  )
)
```

### Timeout Handling

```typescript
import { Stream, Duration } from "effect"

const withTimeout = parseNDJSON<ClaudeEvent>(stdout).pipe(
  Stream.timeout(Duration.minutes(5)),
  Stream.mapError((e) =>
    e._tag === "TimeoutException"
      ? new TimeoutError({ operation: "stream", durationMs: 300000 })
      : e
  )
)
```

### Broadcasting to Dashboard

```typescript
const broadcastEvents = (
  dashboard: DashboardService,
  source: Stream.Stream<ClaudeEvent, StreamError>
) =>
  source.pipe(
    Stream.tap((event) =>
      dashboard.broadcast({ type: "claude_event", data: event })
    ),
    Stream.runDrain
  )
```

## Complete NDJSON Module

```typescript
// src/streams/ndjson.ts
import { Stream, Effect, Chunk } from "effect"
import { StreamError } from "../errors"

/**
 * Parse NDJSON stream into typed objects.
 *
 * Handles:
 * - UTF-8 decoding
 * - Line splitting with buffering
 * - JSON parsing with error recovery
 * - Empty line filtering
 */
export const parseNDJSON = <T>(
  source: Stream.Stream<Uint8Array, StreamError>
): Stream.Stream<T, StreamError> =>
  source.pipe(
    Stream.decodeText("utf-8"),
    Stream.splitLines,
    Stream.filter((line) => line.trim().length > 0),
    Stream.mapEffect((line) =>
      Effect.try({
        try: () => JSON.parse(line) as T,
        catch: (e) => new StreamError({
          message: "Invalid JSON in NDJSON stream",
          line: line.slice(0, 100),  // Truncate for logging
          cause: e
        })
      })
    )
  )

/**
 * Parse NDJSON with fallback for non-JSON lines.
 *
 * Returns Either<T, string> - Right for valid JSON, Left for raw text.
 */
export const parseNDJSONWithFallback = <T>(
  source: Stream.Stream<Uint8Array, StreamError>
): Stream.Stream<{ json: T } | { text: string }, StreamError> =>
  source.pipe(
    Stream.decodeText("utf-8"),
    Stream.splitLines,
    Stream.filter((line) => line.trim().length > 0),
    Stream.map((line) => {
      try {
        return { json: JSON.parse(line) as T }
      } catch {
        return { text: line }
      }
    })
  )

/**
 * Create NDJSON stream from ReadableStream.
 */
export const fromReadableStream = <T>(
  source: ReadableStream<Uint8Array>
): Stream.Stream<T, StreamError> =>
  Stream.fromReadableStream(
    () => source,
    (error) => new StreamError({
      message: "ReadableStream error",
      cause: error
    })
  ).pipe(
    (s) => parseNDJSON<T>(s)
  )

/**
 * Consume stream and collect all events.
 */
export const collectAll = <T>(
  source: Stream.Stream<T, StreamError>
): Effect.Effect<T[], StreamError> =>
  source.pipe(
    Stream.runCollect,
    Effect.map(Chunk.toArray)
  )

/**
 * Consume stream with callback for each event.
 */
export const forEach = <T>(
  source: Stream.Stream<T, StreamError>,
  callback: (event: T) => Effect.Effect<void>
): Effect.Effect<void, StreamError> =>
  source.pipe(
    Stream.tap(callback),
    Stream.runDrain
  )
```

## Error Recovery Strategies

### Skip Invalid Lines

```typescript
const lenient = parseNDJSON<ClaudeEvent>(stdout).pipe(
  Stream.catchAll((error) => {
    if (error._tag === "StreamError") {
      console.warn(`Skipping invalid line: ${error.line}`)
      return Stream.empty
    }
    return Stream.fail(error)
  })
)
```

### Retry on Transient Errors

```typescript
import { Stream, Schedule } from "effect"

const withRetry = Stream.retry(
  parseNDJSON<ClaudeEvent>(stdout),
  Schedule.exponential(100).pipe(
    Schedule.compose(Schedule.recurs(3))
  )
)
```

### Graceful Degradation

```typescript
const degraded = parseNDJSONWithFallback<ClaudeEvent>(stdout).pipe(
  Stream.tap((result) => {
    if ("text" in result) {
      // Forward raw text to output
      return dashboard.sendOutput(result.text + "\n")
    }
    // Forward JSON event
    return dashboard.broadcast({
      type: "claude_event",
      data: result.json
    })
  })
)
```

## Integration with Claude Service

```typescript
// src/layers/ClaudeLive.ts
import { parseNDJSON } from "../streams/ndjson"

const runWithEvents = (container: string, prompt: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const docker = yield* DockerService
      const config = yield* ConfigService

      const { stdout, exitCode } = yield* docker.execStream(
        container,
        ["claude", "-p", "--output-format", "stream-json", prompt],
        { user: "node" }
      )

      // Parse NDJSON and add timeout
      return parseNDJSON<ClaudeEvent>(stdout).pipe(
        Stream.timeout(config.timeoutMs),
        Stream.ensuring(
          exitCode.pipe(
            Effect.tap((code) =>
              code !== 0
                ? Effect.logWarning(`Claude exited with code ${code}`)
                : Effect.void
            )
          )
        )
      )
    })
  )
```

## Testing Streams

```typescript
import { describe, test, expect } from "bun:test"
import { Stream, Effect, Chunk } from "effect"
import { parseNDJSON } from "./ndjson"

describe("parseNDJSON", () => {
  test("parses valid NDJSON", async () => {
    const input = Stream.make(
      new TextEncoder().encode('{"type":"init"}\n{"type":"message"}\n')
    )

    const result = await parseNDJSON<{ type: string }>(input).pipe(
      Stream.runCollect,
      Effect.map(Chunk.toArray),
      Effect.runPromise
    )

    expect(result).toEqual([
      { type: "init" },
      { type: "message" }
    ])
  })

  test("handles empty lines", async () => {
    const input = Stream.make(
      new TextEncoder().encode('{"type":"a"}\n\n{"type":"b"}\n')
    )

    const result = await parseNDJSON<{ type: string }>(input).pipe(
      Stream.runCollect,
      Effect.map(Chunk.toArray),
      Effect.runPromise
    )

    expect(result).toHaveLength(2)
  })

  test("fails on invalid JSON", async () => {
    const input = Stream.make(
      new TextEncoder().encode('not valid json\n')
    )

    const result = await parseNDJSON<unknown>(input).pipe(
      Stream.runCollect,
      Effect.either,
      Effect.runPromise
    )

    expect(result._tag).toBe("Left")
  })
})
```

## Performance Considerations

1. **Chunked processing**: Stream processes data in chunks, not all at once
2. **Backpressure**: Downstream consumers control the rate
3. **Memory efficiency**: Only current chunk in memory
4. **Cancellation**: Streams can be interrupted cleanly

```typescript
// Process in batches of 10
const batched = parseNDJSON<ClaudeEvent>(stdout).pipe(
  Stream.grouped(10),
  Stream.mapEffect((batch) =>
    Effect.forEach(batch, processEvent, { concurrency: 5 })
  )
)
```
