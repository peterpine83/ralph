import { describe, test, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { parseNDJSON } from "./ndjson.js"
import { StreamError } from "../errors/index.js"

describe("parseNDJSON", () => {
  test("parses valid NDJSON stream", async () => {
    const input = Stream.make(
      '{"name":"Alice","age":30}\n',
      '{"name":"Bob","age":25}\n',
      '{"name":"Charlie","age":35}'
    )

    const result = await input.pipe(
      parseNDJSON<{ name: string; age: number }>,
      Stream.runCollect,
      Effect.map((chunk) => Array.from(chunk)),
      Effect.runPromise
    )

    expect(result).toEqual([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
      { name: "Charlie", age: 35 },
    ])
  })

  test("filters empty lines", async () => {
    const input = Stream.make(
      '{"id":1}\n',
      '\n',
      '{"id":2}\n',
      '   \n',
      '{"id":3}'
    )

    const result = await input.pipe(
      parseNDJSON<{ id: number }>,
      Stream.runCollect,
      Effect.map((chunk) => Array.from(chunk)),
      Effect.runPromise
    )

    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
  })

  test("fails with StreamError on invalid JSON", async () => {
    const input = Stream.make('{"valid":true}\n', 'invalid json\n', '{"id":2}')

    const result = input.pipe(
      parseNDJSON<{ valid?: boolean; id?: number }>,
      Stream.runCollect,
      Effect.flip
    )

    await Effect.gen(function* (_) {
      const error = yield* _(result)
      expect(error).toBeInstanceOf(StreamError)
      expect(error._tag).toBe("StreamError")
      expect(error.streamType).toBe("ndjson")
      expect(error.message).toContain("invalid json")
    }).pipe(Effect.runPromise)
  })

  test("handles multiple lines in single string", async () => {
    const input = Stream.make('{"a":1}\n{"b":2}\n{"c":3}')

    const result = await input.pipe(
      parseNDJSON<{ [key: string]: number }>,
      Stream.runCollect,
      Effect.map((chunk) => Array.from(chunk)),
      Effect.runPromise
    )

    expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  test("truncates long invalid lines in error message", async () => {
    const longInvalidLine = "x".repeat(150)
    const input = Stream.make(longInvalidLine)

    const result = input.pipe(
      parseNDJSON<unknown>,
      Stream.runCollect,
      Effect.flip
    )

    await Effect.gen(function* (_) {
      const error = yield* _(result)
      // Message format: "Invalid JSON in NDJSON stream: " (31 chars) + line.slice(0, 100)
      expect(error.message.length).toBeLessThanOrEqual(131)
      expect(error.message).toContain("Invalid JSON in NDJSON stream:")
    }).pipe(Effect.runPromise)
  })

  test("parses array values", async () => {
    const input = Stream.make(
      '{"items":[1,2,3]}\n',
      '{"items":[4,5,6]}'
    )

    const result = await input.pipe(
      parseNDJSON<{ items: number[] }>,
      Stream.runCollect,
      Effect.map((chunk) => Array.from(chunk)),
      Effect.runPromise
    )

    expect(result).toEqual([{ items: [1, 2, 3] }, { items: [4, 5, 6] }])
  })

  test("parses nested objects", async () => {
    const input = Stream.make(
      '{"user":{"name":"Alice","email":"alice@example.com"}}\n',
      '{"user":{"name":"Bob","email":"bob@example.com"}}'
    )

    const result = await input.pipe(
      parseNDJSON<{ user: { name: string; email: string } }>,
      Stream.runCollect,
      Effect.map((chunk) => Array.from(chunk)),
      Effect.runPromise
    )

    expect(result).toEqual([
      { user: { name: "Alice", email: "alice@example.com" } },
      { user: { name: "Bob", email: "bob@example.com" } },
    ])
  })

  test("handles empty stream", async () => {
    const input = Stream.empty

    const result = await input.pipe(
      parseNDJSON<unknown>,
      Stream.runCollect,
      Effect.map((chunk) => Array.from(chunk)),
      Effect.runPromise
    )

    expect(result).toEqual([])
  })

  test("handles stream with only whitespace", async () => {
    const input = Stream.make('\n', '   \n', '\t\n', '  ')

    const result = await input.pipe(
      parseNDJSON<unknown>,
      Stream.runCollect,
      Effect.map((chunk) => Array.from(chunk)),
      Effect.runPromise
    )

    expect(result).toEqual([])
  })

  test("StreamError includes cause", async () => {
    const input = Stream.make('not valid json')

    const result = input.pipe(
      parseNDJSON<unknown>,
      Stream.runCollect,
      Effect.flip
    )

    await Effect.gen(function* (_) {
      const error = yield* _(result)
      expect(error.cause).toBeDefined()
      expect(error.cause).toBeInstanceOf(Error)
    }).pipe(Effect.runPromise)
  })

  test("can be caught with Effect.catchTag", async () => {
    const input = Stream.make('invalid')

    const result = await input.pipe(
      parseNDJSON<unknown>,
      Stream.runCollect,
      Effect.catchTag("StreamError", (e) =>
        Effect.succeed(`Caught ${e.streamType} error: ${e.message}`)
      ),
      Effect.runPromise
    )

    expect(result).toMatch(/Caught ndjson error/)
  })
})
