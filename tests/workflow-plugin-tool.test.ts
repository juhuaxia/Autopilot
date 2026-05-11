import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import workflowPlugin from "../packages/runtime/src/plugin/workflow-plugin-entry"
import type { PluginSdkClient } from "../packages/adapters/opencode/src/opencode-session-client"

describe("workflow plugin tool export", () => {
  it("exposes workflow_channel tool and executes workflow-status-like flow", async () => {
    const plugin = await workflowPlugin({
      directory: "/tmp/workflow-plugin-tool",
    })

    const output = await plugin.tool.workflow_channel.execute({
      command: "workflow-open",
      workflowId: "wf-tool",
      payload: "新增订单列表页筛选条件。",
    })

    expect(plugin.tool.workflow_channel.description).toContain("workflow")
    expect(output).toContain("Workflow: wf-tool")
  })

  it("exposes dedicated workflow_open and workflow_status tools", async () => {
    const plugin = await workflowPlugin({
      directory: "/tmp/workflow-plugin-tool-2",
    })

    const openOutput = await plugin.tool.workflow_open.execute({
      workflowId: "wf-split",
      payload: "新增价格排序功能。",
    })
    const statusOutput = await plugin.tool.workflow_status.execute({ workflowId: "wf-split" })

    expect(openOutput).toContain("Workflow: wf-split")
    expect(statusOutput).toContain("Workflow: wf-split")
    expect(typeof plugin.tool.workflow_answer.execute).toBe("function")
    expect(typeof plugin.tool.workflow_approve.execute).toBe("function")
    expect(typeof plugin.tool.workflow_resume.execute).toBe("function")
    expect(typeof plugin.tool.workflow_back.execute).toBe("function")
    expect(typeof plugin.tool.workflow_doctor.execute).toBe("function")
    expect(typeof plugin.tool.workflow_install.execute).toBe("function")
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

  it("exposes workflow_install and returns installer JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-plugin-install-"))
    const plugin = await workflowPlugin({ directory: dir })

    const output = await plugin.tool.workflow_install.execute()

    expect(output).toContain("projectWorkflowConfigFile")
    expect(output).toContain("opencodeConfigFile")
    expect(output).toContain("pluginEntry")

    await rm(dir, { recursive: true, force: true })
  })

  it("rejects workflow commands with an empty workflowId", async () => {
    const plugin = await workflowPlugin({ directory: "/tmp/workflow-plugin-empty-id" })

    await expect(plugin.tool.workflow_open.execute({ workflowId: "", payload: "新增空 workflowId 验证。" })).rejects.toThrow("workflowId is required")
    await expect(plugin.tool.workflow_attach.execute({ workflowId: "" })).rejects.toThrow()
  })

  it("re-attaches to a workflow after fresh plugin load (session recovery)", async () => {
    const dir = "/tmp/workflow-plugin-reattach"

    const first = await workflowPlugin({ directory: dir })
    await first.tool.workflow_open.execute({ workflowId: "wf-reattach", payload: "新增重新挂载验证。" })

    const second = await workflowPlugin({ directory: dir })
    const result = await second.tool.workflow_attach.execute({ workflowId: "wf-reattach" })

    expect(result).toContain("wf-reattach")
  })

  it("writes native primary-agent contract artifacts for host integration", async () => {
    const dir = "/tmp/workflow-plugin-agent-contract"
    const plugin = await workflowPlugin({ directory: dir })

    const manifest = await readFile(`${dir}/.workflow-harness/workflow-primary-agent.manifest.json`, "utf8")
    const prompt = await readFile(`${dir}/.workflow-harness/workflow-primary-agent.prompt.md`, "utf8")

    expect(manifest).toContain('"name": "workflow"')
    expect(manifest).toContain('"mode": "primary"')
    expect(manifest).toContain('"workflow_open"')
    expect(prompt).toContain("runtime state machine is the only authority")
    expect(plugin.workflow.primaryAgent.name).toBe("workflow")
  })

  it("registers workflow as native primary agent through config hook", async () => {
    const plugin = await workflowPlugin({ directory: "/tmp/workflow-plugin-native-agent" })
    const cfg: {
      agent?: Record<string, {
        mode: "primary" | "subagent" | "all"
        description: string
        model: string
        prompt: string
        tools: Record<string, boolean>
      }>
    } = {}

    await plugin.config(cfg)

    const workflowAgent = cfg.agent?.workflow
    expect(workflowAgent).toBeDefined()
    expect(workflowAgent?.mode).toBe("primary")
    expect(workflowAgent?.tools.workflow_open).toBe(true)
    expect(workflowAgent?.prompt).toContain("workflow execution agent")
  })

  it("syncs workflow progress to host todo client when available", async () => {
    const created: string[] = []
    const updated: string[] = []
    const plugin = await workflowPlugin({
      directory: "/tmp/workflow-plugin-host-todo",
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
