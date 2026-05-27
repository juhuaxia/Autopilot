import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import workflowPlugin from "../packages/runtime/src/plugin/workflow-plugin-entry"

describe("workflow plugin wiring", () => {
  it("returns a plugin-like object with workflow commands", async () => {
    const plugin = await workflowPlugin({
      directory: "/tmp/workflow-plugin",
    })

    expect(plugin).toHaveProperty("workflow")
    expect(plugin).toHaveProperty("workflowCommands")
    expect(plugin).toHaveProperty("healthcheck")
    expect(plugin).toHaveProperty("tool")
    expect(plugin.workflow.name).toBe("autopilot")
    expect(plugin.workflow.commands.some((command: { name: string }) => command.name === "workflow-open")).toBe(true)
    expect(await plugin.healthcheck()).toMatchObject({ ok: true, name: "autopilot" })
    expect(typeof plugin.tool.workflow_channel.execute).toBe("function")
    expect(typeof plugin.tool.workflow_open.execute).toBe("function")
    expect(typeof plugin.tool.workflow_back.execute).toBe("function")
    expect(typeof plugin.tool.workflow_doctor.execute).toBe("function")
    expect(typeof plugin.tool.ap_doctor.execute).toBe("function")
    expect(typeof plugin.tool.workflow_install.execute).toBe("function")
    expect(typeof plugin.tool.autopilot_update.execute).toBe("function")
  })

  it("returns agent-friendly guidance in workflow output", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "workflow-plugin-guidance-"))
    const workflowId = `wf-guidance-${Date.now()}`
    const plugin = await workflowPlugin({
      directory: workspaceDir,
    })

    try {
      const output = await plugin.tool.workflow_open.execute({
        workflowId,
        payload: "新增结算流程说明。",
      })

      expect(output).toContain(`Workflow: ${workflowId}`)
      expect(output).toContain("Recommended tool:")
      expect(output).toContain("Human action:")
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})
