import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHarness } from "../packages/runtime/src/bootstrap/create-harness"
import { DefaultWorkflowCommandRunner } from "../packages/runtime/src/commands/default-workflow-command-runner"
import { createOpencodeWorkflowCommands } from "../packages/runtime/src/commands/create-opencode-workflow-commands"
import { DefaultWorkflowPluginCommandAdapter } from "../packages/runtime/src/commands/opencode-plugin-command-adapter"

describe("opencode plugin command adapter", () => {
  it("exposes workflow-open command through plugin adapter", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-plugin-adapter-"))
    const runner = new DefaultWorkflowCommandRunner()
    const adapter = new DefaultWorkflowPluginCommandAdapter(
      runner,
      () => createHarness(baseDir),
    )
    const commands = createOpencodeWorkflowCommands(adapter)
    const open = commands.find((command) => command.name === "workflow-open")

    expect(open).toBeDefined()
    const output = await open!.execute({ workflowId: "wf-plugin", payload: "新增插件适配器打开工作流验证。" })

    expect(output.text).toContain("Workflow: wf-plugin")

    await rm(baseDir, { recursive: true, force: true })
  })
})
