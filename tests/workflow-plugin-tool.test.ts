import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import workflowPlugin from "../packages/runtime/src/plugin/workflow-plugin-entry"
import type { PluginSdkClient } from "../packages/adapters/opencode/src/opencode-session-client"

describe("workflow plugin tool export", () => {
  it("exposes workflow_channel tool and executes workflow-status-like flow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-tool-"))
    const plugin = await workflowPlugin({
      directory: dir,
    })

    const output = await plugin.tool.workflow_channel.execute({
      command: "workflow-open",
      workflowId: "wf-tool",
      payload: "请开始实现：新增订单列表页筛选条件。",
    })

    expect(plugin.tool.workflow_channel.description).toContain("workflow")
    expect(output).toContain("Workflow: wf-tool")

    await rm(dir, { recursive: true, force: true })
  })

  it("exposes dedicated workflow_open and workflow_status tools", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-tool-2-"))
    const plugin = await workflowPlugin({
      directory: dir,
    })

    const openOutput = await plugin.tool.workflow_open.execute({
      workflowId: "wf-split",
      payload: "请开始实现：新增价格排序功能。",
    })

    const workflowRoot = join(dir, ".workflow-harness", "workflows")
    const workflowIds = (await readdir(workflowRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    const targetWorkflowId = workflowIds.find((id) => id === "wf-split" || id.startsWith("wf-split-"))
    expect(targetWorkflowId).toBeDefined()

    const statusOutput = await plugin.tool.workflow_status.execute({ workflowId: targetWorkflowId! })

    expect(openOutput).toContain("Workflow:")
    expect(statusOutput).toContain(`Workflow: ${targetWorkflowId}`)
    expect(typeof plugin.tool.workflow_answer.execute).toBe("function")
    expect(typeof plugin.tool.workflow_approve.execute).toBe("function")
    expect(typeof plugin.tool.workflow_resume.execute).toBe("function")
    expect(typeof plugin.tool.workflow_resync.execute).toBe("function")
    expect(typeof plugin.tool.workflow_back.execute).toBe("function")
    expect(typeof plugin.tool.workflow_doctor.execute).toBe("function")
    expect(typeof plugin.tool.ap_doctor.execute).toBe("function")
    expect(typeof plugin.tool.workflow_install.execute).toBe("function")
    expect(typeof plugin.tool.autopilot_update.execute).toBe("function")

    await rm(dir, { recursive: true, force: true })
  })

  it("exposes workflow_doctor and returns diagnostic JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-doctor-"))
    const plugin = await workflowPlugin({ directory: dir })

    const output = await plugin.tool.workflow_doctor.execute()

    expect(output).toContain("projectConfigFile")
    expect(output).toContain("requiredSkills")
    expect(output).toContain("warnings")

    await rm(dir, { recursive: true, force: true })
  })

  it("registers ap-doctor as a host command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-ap-doctor-host-"))
    await mkdir(join(dir, ".workflow-harness"), { recursive: true })
    await Bun.write(join(dir, ".workflow-harness", "autopilot.json"), JSON.stringify({ skillRoots: [] }, null, 2))
    const plugin = await workflowPlugin({ directory: dir })
    const cfg: { command?: Record<string, { template: string; description: string; agent?: string }> } = {}

    await plugin.config(cfg)

    expect(cfg.command?.["ap-doctor"]).toBeDefined()
    expect(cfg.command?.["ap-doctor"]?.template).toBe("Run ap_doctor for workflowId=$ARGUMENTS. Return the diagnosis verbatim.")
    expect(cfg.command?.["ap-doctor"]?.agent).toBe("workflow")

    await rm(dir, { recursive: true, force: true })
  })

  it("exposes ap_doctor and returns short runtime diagnosis", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-ap-doctor-"))
    const plugin = await workflowPlugin({ directory: dir })

    await plugin.tool.workflow_open.execute({ workflowId: "wf-ap-doctor", payload: "新增 ap doctor 验证。" })
    const output = await plugin.tool.ap_doctor.execute({ workflowId: "wf-ap-doctor" })

    expect(output).toContain("状态：")
    expect(output).toContain("原因：")
    expect(output).toContain("建议：")

    await rm(dir, { recursive: true, force: true })
  })

  it("does not mutate spec_refinement artifact when ap_doctor runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-ap-doctor-readonly-"))
    const plugin = await workflowPlugin({ directory: dir })

    await plugin.tool.workflow_open.execute({ workflowId: "wf-ap-doctor-readonly", payload: "新增 ap doctor 只读验证。" })
    const artifactPath = join(dir, ".workflow-harness", "workflows", "wf-ap-doctor-readonly", "spec_refinement.md")
    const before = await readFile(artifactPath, "utf8")

    await plugin.tool.ap_doctor.execute({ workflowId: "wf-ap-doctor-readonly" })

    const after = await readFile(artifactPath, "utf8")
    expect(after).toBe(before)

    await rm(dir, { recursive: true, force: true })
  })

  it("exposes workflow_install and returns installer JSON", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "workflow-plugin-install-home-"))
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-install-"))
    try {
      await mkdir(join(homeDir, ".config", "opencode"), { recursive: true })
      const plugin = await workflowPlugin({ directory: dir, homeDir })
      const output = await plugin.tool.workflow_install.execute()
      const configPath = join(homeDir, ".config", "opencode", "opencode.json")
      const configText = await Bun.file(configPath).text()

      expect(output).toContain("projectWorkflowConfigFile")
      expect(output).toContain("opencodeConfigFile")
      expect(output).toContain("pluginEntry")
      expect(output).toContain("@fkqfkq123/opencode-autopilot")
      expect(configText).toContain("@fkqfkq123/opencode-autopilot")
      expect(configText).not.toContain("workflow-plugin-install")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(homeDir, { recursive: true, force: true })
    }
  })

  it("exposes autopilot_update tool", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "workflow-plugin-update-home-"))
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-update-"))
    try {
      await mkdir(join(dir, ".workflow-harness"), { recursive: true })
      await Bun.write(join(dir, ".workflow-harness", "autopilot.json"), JSON.stringify({ skillRoots: [] }, null, 2))
      await Bun.write(join(dir, "autopilot.json"), JSON.stringify({ skillRoots: [] }, null, 2))
      await mkdir(join(homeDir, ".config", "opencode"), { recursive: true })
      await Bun.write(join(homeDir, ".config", "opencode", "opencode.json"), JSON.stringify({ plugin: ["@fkqfkq123/opencode-autopilot"] }, null, 2))
      const plugin = await workflowPlugin({ directory: dir, homeDir })
      expect(typeof plugin.tool.autopilot_update.execute).toBe("function")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(homeDir, { recursive: true, force: true })
    }
  })

  it("rejects workflow commands with an empty workflowId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-empty-id-"))
    const plugin = await workflowPlugin({ directory: dir })

    await expect(plugin.tool.workflow_open.execute({ workflowId: "", payload: "新增空 workflowId 验证。" })).rejects.toThrow("workflowId is required")
    await expect(plugin.tool.workflow_attach.execute({ workflowId: "" })).rejects.toThrow()

    await rm(dir, { recursive: true, force: true })
  })

  it("re-attaches to a workflow after fresh plugin load (session recovery)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-reattach-"))

    const first = await workflowPlugin({ directory: dir })
    await first.tool.workflow_open.execute({ workflowId: "wf-reattach", payload: "新增重新挂载验证。" })

    const second = await workflowPlugin({ directory: dir })
    const result = await second.tool.workflow_attach.execute({ workflowId: "wf-reattach" })

    expect(result).toContain("wf-reattach")

    await rm(dir, { recursive: true, force: true })
  })

  it("writes native primary-agent contract artifacts for host integration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-agent-contract-"))
    const plugin = await workflowPlugin({ directory: dir })

    const manifest = await readFile(`${dir}/.workflow-harness/workflow-primary-agent.manifest.json`, "utf8")
    const prompt = await readFile(`${dir}/.workflow-harness/workflow-primary-agent.prompt.md`, "utf8")

    expect(manifest).toContain('"name": "workflow"')
    expect(manifest).toContain('"mode": "primary"')
    expect(manifest).toContain('"workflow_open"')
    expect(prompt).toContain("runtime state machine is the only authority")
    expect(plugin.workflow.primaryAgent.name).toBe("workflow")

    await rm(dir, { recursive: true, force: true })
  })

  it("registers workflow as native primary agent through config hook", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-native-agent-"))
    const plugin = await workflowPlugin({ directory: dir })
    const cfg: {
      agent?: Record<string, {
        mode: "primary" | "subagent" | "all"
        description: string
        model: string
        prompt: string
        tools: Record<string, boolean>
      }>
    } = {}

    await plugin.healthcheck()
    await plugin.config(cfg)

    const workflowAgent = cfg.agent?.workflow
    expect(workflowAgent).toBeDefined()
    expect(workflowAgent?.mode).toBe("primary")
    expect(workflowAgent?.tools.workflow_open).toBe(true)
    expect(workflowAgent?.prompt).toContain("workflow execution agent")
    expect(workflowAgent?.prompt).toContain("prefer workflow_resume with payload fix")

    await rm(dir, { recursive: true, force: true })
  })

  it("syncs workflow progress to host todo client when available", async () => {
    const created: string[] = []
    const updated: string[] = []
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-host-todo-"))
    const plugin = await workflowPlugin({
      directory: dir,
      client: {
        session: {
          create: async () => ({ id: "session-1" }),
          prompt: async () => ({}),
          abort: async () => ({}),
          status: async () => ({ type: "idle" }),
          todo: {
            list: async () => ({ data: [] }),
            create: async ({ body }: { path: { id: string }; body: { title: string } }) => {
              created.push(body.title)
              return true
            },
            update: async ({ body }: { path: { id: string; todoId: string }; body: { completed?: boolean } }) => {
              updated.push(String(body.completed))
              return true
            },
          },
        },
      } satisfies PluginSdkClient,
    })

    await plugin.tool.workflow_open.execute({ workflowId: "wf-host-todo", payload: "新增宿主 todo 同步验证。" })

    expect(created).toContain("Workflow / Refinement")
    expect(created).toContain("Workflow / Plan")
    expect(created).toContain("Workflow / Develop")
    expect(updated.length).toBe(0)

    await rm(dir, { recursive: true, force: true })
  })

  it("syncs node run todos with node-specific titles", async () => {
    const created: string[] = []
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-node-todo-"))
    const plugin = await workflowPlugin({
      directory: dir,
      client: {
        session: {
          create: async () => ({ id: "session-node-1" }),
          prompt: async () => ({}),
          abort: async () => ({}),
          status: async () => ({ type: "idle" }),
          todo: {
            list: async () => ({ data: [] }),
            create: async ({ body }: { path: { id: string }; body: { title: string } }) => {
              created.push(body.title)
              return true
            },
            update: async () => true,
          },
        },
      } satisfies PluginSdkClient,
    })

    await plugin.tool.workflow_open.execute({ workflowId: "wf-node-todo", payload: "请执行 review-heavy 节点任务。" })

    expect(created.some((title) => title.startsWith("Review Run /"))).toBe(false)

    await rm(dir, { recursive: true, force: true })
  })

  it("prefers host SDK client for workflow execution when available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-sdk-session-"))
    let usedPrompt = false
    const plugin = await workflowPlugin({
      directory: dir,
      client: {
        session: {
          create: async () => ({ data: { id: "ses-sdk-1" } }),
          promptAsync: async () => ({}),
          prompt: async () => {
            usedPrompt = true
            return {}
          },
          abort: async () => ({}),
          status: async () => ({ data: { type: "idle" } }),
        },
      } satisfies PluginSdkClient,
    })

    const output = await plugin.tool.workflow_open.execute({
      workflowId: "wf-sdk-session",
      payload: "新增 SDK session client 接入验证。",
    })

    expect(output).toContain("Workflow: wf-sdk-session")
    expect(output).toContain("Phase: spec_refinement")
    expect(usedPrompt).toBe(true)

    await rm(dir, { recursive: true, force: true })
  })
})
