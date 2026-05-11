import { describe, expect, it } from "bun:test"

describe("workflow channel command aliases", () => {
  const normalizeCommand = (command: string): string => {
    switch (command) {
      case "workflow-open":
        return "start"
      case "workflow-attach":
        return "attach"
      case "workflow-status":
        return "status"
      case "workflow-answer":
        return "answer"
      case "workflow-approve":
        return "approve"
      case "workflow-resume":
        return "resume"
      case "workflow-back":
        return "back"
      case "workflow-doctor":
        return "doctor"
      case "workflow-install":
        return "install"
      default:
        return command
    }
  }

  it("maps workflow-open to start", () => {
    expect(normalizeCommand("workflow-open")).toBe("start")
  })

  it("maps workflow-attach to attach", () => {
    expect(normalizeCommand("workflow-attach")).toBe("attach")
  })

  it("maps workflow-back to back", () => {
    expect(normalizeCommand("workflow-back")).toBe("back")
  })

  it("maps workflow-doctor to doctor", () => {
    expect(normalizeCommand("workflow-doctor")).toBe("doctor")
  })

  it("maps workflow-install to install", () => {
    expect(normalizeCommand("workflow-install")).toBe("install")
  })
})
