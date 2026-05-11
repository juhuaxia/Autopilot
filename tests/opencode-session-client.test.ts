import { describe, expect, it } from "bun:test"
import { SdkOpencodeSessionClient, type PluginSdkClient } from "../packages/adapters/opencode/src/opencode-session-client"

describe("sdk opencode session client", () => {
  it("uses prompt() to wake an idle session", async () => {
    let promptCalls = 0
    let promptAsyncCalls = 0
    const client: PluginSdkClient = {
      session: {
        create: async () => ({ data: { id: "ses-idle" } }),
        prompt: async () => {
          promptCalls += 1
          return {}
        },
        promptAsync: async () => {
          promptAsyncCalls += 1
          return {}
        },
        abort: async () => ({}),
        status: async () => ({ data: { type: "idle" } }),
      },
    }

    const sdk = new SdkOpencodeSessionClient(client)
    await sdk.ensureSessionReady("ses-idle", "idle session")
    const result = await sdk.injectPrompt({ sessionId: "ses-idle", prompt: "continue workflow" })

    expect(promptCalls).toBe(1)
    expect(promptAsyncCalls).toBe(0)
    expect(result.dispatchMode).toBe("sdk_prompt_background")
    expect(result.statusBefore).toBe("idle")
  })

  it("uses promptAsync() to append to a running session", async () => {
    let promptCalls = 0
    let promptAsyncCalls = 0
    const client: PluginSdkClient = {
      session: {
        create: async () => ({ data: { id: "ses-running" } }),
        prompt: async () => {
          promptCalls += 1
          return {}
        },
        promptAsync: async () => {
          promptAsyncCalls += 1
          return {}
        },
        abort: async () => ({}),
        status: async () => ({ data: { type: "busy" } }),
      },
    }

    const sdk = new SdkOpencodeSessionClient(client)
    await sdk.ensureSessionReady("ses-running", "running session")
    const result = await sdk.injectPrompt({ sessionId: "ses-running", prompt: "continue workflow" })

    expect(promptCalls).toBe(0)
    expect(promptAsyncCalls).toBe(1)
    expect(result.dispatchMode).toBe("sdk_prompt_async")
    expect(result.statusBefore).toBe("running")
  })
})
