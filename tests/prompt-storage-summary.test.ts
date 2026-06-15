import { describe, expect, it } from "bun:test"
import { buildPromptStorageSummary } from "../packages/runtime/src/shared/prompt-storage-summary"

describe("prompt storage summary", () => {
  it("preserves both leading and trailing prompt blocks when summarizing long prompts", () => {
    const prompt = [
      "[PHASE] review",
      "[HEAD_BLOCK] " + "A".repeat(3000),
      "[MIDDLE_BLOCK] " + "B".repeat(6000),
      "[TAIL_BLOCK] important tail context",
      "[COMPLETION_POLICY] keep final evidence visible",
    ].join("\n\n")

    const result = buildPromptStorageSummary(prompt)

    expect(result.summary).toContain("[PHASE] review")
    expect(result.summary).toContain("[TAIL_BLOCK] important tail context")
    expect(result.summary).toContain("[COMPLETION_POLICY] keep final evidence visible")
    expect(result.summary.length).toBeLessThan(prompt.length)
    expect(result.summary).toContain("[TRUNCATED]")
    expect(result.length).toBe(prompt.length)
    expect(result.hash.length).toBe(16)
  })
})
