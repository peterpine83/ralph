// NDJSON stream parsing utilities
import { Stream, Effect } from "effect"
import { StreamError } from "../errors"

/**
 * Parse NDJSON stream into typed objects.
 *
 * Takes a stream of strings (already decoded from UTF-8),
 * splits on newlines, filters empty lines, and parses JSON.
 */
export const parseNDJSON = <T>(
  source: Stream.Stream<string, StreamError>
): Stream.Stream<T, StreamError> =>
  source.pipe(
    // Split on newlines
    Stream.splitLines,

    // Filter empty lines
    Stream.filter((line) => line.trim().length > 0),

    // Parse JSON with error handling
    Stream.mapEffect((line) =>
      Effect.try({
        try: () => JSON.parse(line) as T,
        catch: (e) =>
          new StreamError({
            streamType: "ndjson",
            message: `Invalid JSON in NDJSON stream: ${line.slice(0, 100)}`,
            cause: e
          })
      })
    )
  )
