import { describe, expect, it } from "bun:test"
import { HttpOpencodeSessionClient } from "../packages/adapters/opencode/src/opencode-session-client"

describe("http opencode session client", () => {
  it("surfaces event pump failures as session.error events instead of stalling", async () => {
    const client = new HttpOpencodeSessionClient({
      baseUrl: "http://127.0.0.1:1",
    })

    await client.ensureSessionReady("session-1", "test")
    const iterator = client.streamEvents("session-1")[Symbol.asyncIterator]()
    const result = await iterator.next()

    expect(result.done).toBe(false)
    expect(result.value?.type).toBe("session.error")
    expect(String(result.value?.payload?.message ?? "").length).toBeGreaterThan(0)
  })
})
