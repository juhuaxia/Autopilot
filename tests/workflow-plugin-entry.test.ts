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

  it("injects public slash commands into host config", async () => {
    const plugin = await (await import("../packages/runtime/src/plugin/workflow-plugin-entry")).default({
      directory: join(tmpdir(), "workflow-plugin-entry-config"),
    })
    type PluginConfig = Parameters<NonNullable<typeof plugin.config>>[0]
    const cfg: PluginConfig = {}

    await plugin.config?.(cfg)

    expect(cfg.agent?.workflow?.model).toBeUndefined()
    expect(cfg.command?.["ap-light"]?.description).toContain("Quick develop mode")
    expect(cfg.command?.["ap-light"]?.agent).toBe("workflow")
    expect(cfg.command?.["ap-standard"]?.template).toContain("/ap-mode: standard")
    expect(cfg.command?.["ap-safe"]?.template).toContain("/ap-mode: safe")
    expect(cfg.command?.["ap-debug"]?.template).toContain("/ap-mode: debug")
    expect(cfg.command?.["ap-review-heavy"]?.template).toContain("/ap-mode: review-heavy")
    expect(cfg.command?.["ap-verify"]?.template).toContain("/ap-node-run: verify")
    expect(cfg.command?.["ap-develop"]?.template).toContain("/ap-node-run: develop")
  })
})
