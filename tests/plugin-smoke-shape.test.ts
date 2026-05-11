import { describe, expect, it } from "bun:test"
import pluginEntry from "../plugin"

describe("plugin root export", () => {
  it("returns a host-callable plugin with workflow commands", async () => {
    const plugin = await pluginEntry({
      directory: process.cwd(),
    })

    expect(plugin.workflow).toBeDefined()
    expect(plugin.workflow?.name).toBe("autopilot")
    expect(plugin.workflowCommands?.some((command) => command.name === "workflow-open")).toBe(true)
    expect(await plugin.healthcheck()).toMatchObject({ ok: true })
    expect(typeof plugin.tool.workflow_open.execute).toBe("function")
    expect(typeof plugin.tool.workflow_attach.execute).toBe("function")
    expect(typeof plugin.tool.workflow_status.execute).toBe("function")
  })
})
