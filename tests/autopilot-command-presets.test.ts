import { describe, expect, it } from "bun:test"
import { AUTOPILOT_COMMAND_BRIDGE_PROMPT, buildAutopilotCommandPayload } from "../packages/runtime/src/commands/autopilot-command-presets"

describe("autopilot command presets", () => {
  it("builds light preset directive template with direct-develop startAt", () => {
    const payload = buildAutopilotCommandPayload({
      preset: "light",
      prompt: "$ARGUMENTS",
    })

    expect(payload).toContain(AUTOPILOT_COMMAND_BRIDGE_PROMPT)
    expect(payload).toContain("$ARGUMENTS")
    expect(payload).toContain("/ap-mode: light")
    expect(payload).toContain("/ap-start-at: develop")
  })

  it("builds standard preset directive template without direct-develop startAt", () => {
    const payload = buildAutopilotCommandPayload({
      preset: "standard",
      prompt: "$ARGUMENTS",
    })

    expect(payload).toContain("/ap-mode: standard")
    expect(payload).not.toContain("/ap-start-at: develop")
  })

  it("builds debug preset directive template without direct-develop startAt", () => {
    const payload = buildAutopilotCommandPayload({
      preset: "debug",
      prompt: "$ARGUMENTS",
    })

    expect(payload).toContain("/ap-mode: debug")
    expect(payload).not.toContain("/ap-start-at: develop")
  })

  it("builds review-heavy preset directive template", () => {
    const payload = buildAutopilotCommandPayload({
      preset: "review-heavy",
      prompt: "$ARGUMENTS",
    })

    expect(payload).toContain("/ap-mode: review-heavy")
  })

  it("builds verify preset directive template", () => {
    const payload = buildAutopilotCommandPayload({
      preset: "verify",
      prompt: "$ARGUMENTS",
    })

    expect(payload).toContain("/ap-mode: verify")
  })

  it("builds ap-goal preset directive template", () => {
    const payload = buildAutopilotCommandPayload({
      preset: "ap-goal",
      prompt: "$ARGUMENTS",
    })

    expect(payload).toContain("/ap-mode: ap-goal")
    expect(payload).not.toContain("/ap-start-at: develop")
  })
})
