import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createWorkflowPluginEntry } from "../packages/runtime/src/plugin/workflow-plugin-entry"

describe("workflow plugin entry skeleton", () => {
  it("exposes autopilot plugin name and commands", () => {
    const entry = createWorkflowPluginEntry({
      baseDir: join(tmpdir(), "workflow-plugin-entry"),
    })

    expect(entry.name).toBe("autopilot")
    expect(entry.commands.some((command) => command.name === "workflow-open")).toBe(true)
    expect(entry.commands.some((command) => command.name === "workflow-attach")).toBe(true)
  })
})
