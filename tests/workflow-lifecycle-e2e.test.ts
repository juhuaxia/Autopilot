import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHarness } from "../packages/runtime/src/bootstrap/create-harness"
import { initializeWorkflow } from "../packages/runtime/src/bootstrap/initialize-workflow"
import { DefaultWorkflowCommandRunner } from "../packages/runtime/src/commands/default-workflow-command-runner"
import workflowPlugin from "../packages/runtime/src/plugin/workflow-plugin-entry"

describe("workflow lifecycle: single active + archive", () => {

  // ═══════════════════════════════════════════
  // Scenario 1: Fresh start — no existing workflow
  // ═══════════════════════════════════════════

  describe("fresh start (no existing workflow)", () => {
    it("creates a new workflow when no workflows exist", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-fresh-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      const result = await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "请帮我开发一个新功能。",
          mode: "safe",
        }),
      })

      expect(result.ok).toBe(true)
      expect(result.output).toContain("已创建新的独立任务。")
      expect(result.output).toContain("Phase: spec_refinement")

      const workflows = await harness.stateStore.listWorkflows?.() ?? []
      expect(workflows.length).toBe(1)
      expect(workflows[0]?.phase).toBe("spec_refinement")

      await rm(baseDir, { recursive: true, force: true })
    })

    it("creates a new workflow when only completed workflows exist", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-fresh-completed-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      await initializeWorkflow({
        workflowId: "old-completed",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "旧任务。",
      })
      await harness.stateStore.updateWorkflow("old-completed", {
        phase: "done",
        status: "completed",
      })

      const result = await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "请帮我开发一个全新功能。",
          mode: "safe",
        }),
      })

      expect(result.ok).toBe(true)
      expect(result.output).toContain("已创建新的独立任务。")
      expect(result.output).toContain("Phase: spec_refinement")
      expect(result.output).not.toContain("old-completed")

      await rm(baseDir, { recursive: true, force: true })
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 2: Active workflow exists — ask user
  // ═══════════════════════════════════════════

  describe("active workflow exists (interrupted scenario)", () => {
    it("asks user to choose resume or new when active workflow exists", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-active-ask-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      await initializeWorkflow({
        workflowId: "active-task",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "正在进行的任务。",
      })
      await harness.stateStore.updateWorkflow("active-task", {
        phase: "develop",
        status: "in_progress",
      })

      const result = await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "请帮我开发另一个功能。",
          mode: "safe",
        }),
      })

      expect(result.ok).toBe(true)
      expect(result.output).toContain("检测到未完成的工作流")
      expect(result.output).toContain("active-task")
      expect(result.output).toMatch(/继续|恢复/)
      expect(result.output).toMatch(/新开|新建/)

      await rm(baseDir, { recursive: true, force: true })
    })

    it("resumes active workflow when user answers resume", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-active-resume-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      await initializeWorkflow({
        workflowId: "active-task",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "正在进行的任务。",
      })
      await harness.stateStore.updateWorkflow("active-task", {
        phase: "develop",
        status: "in_progress",
      })

      // First call triggers the question
      await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "请帮我开发另一个功能。",
          mode: "safe",
        }),
      })

      // User answers "resume"
      const resumeResult = await runner.run({
        harness,
        command: "workflow-answer",
        workflowId: "autopilot",
        payload: JSON.stringify({ lifecycle_decision: "resume" }),
      })

      expect(resumeResult.ok).toBe(true)
      expect(resumeResult.output).toContain("Workflow: active-task")
      expect(resumeResult.output).toContain("Phase: develop")

      await rm(baseDir, { recursive: true, force: true })
    })

    it("resumes the originally prompted workflow even if another workflow updates later", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-active-resume-stable-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      await initializeWorkflow({
        workflowId: "active-task",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "原始活跃任务。",
      })
      await harness.stateStore.updateWorkflow("active-task", {
        phase: "develop",
        status: "in_progress",
        updatedAt: new Date(Date.now() - 60_000).toISOString(),
      })

      await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "请帮我开发另一个功能。",
          mode: "safe",
        }),
      })

      await initializeWorkflow({
        workflowId: "other-task",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "后来变新的任务。",
      })
      await harness.stateStore.updateWorkflow("other-task", {
        phase: "review",
        status: "in_progress",
        updatedAt: new Date().toISOString(),
      })

      const resumeResult = await runner.run({
        harness,
        command: "workflow-answer",
        workflowId: "autopilot",
        payload: JSON.stringify({ answer: "1" }),
      })

      expect(resumeResult.ok).toBe(true)
      expect(resumeResult.output).toContain("Workflow: active-task")
      expect(resumeResult.output).not.toContain("Workflow: other-task")

      await rm(baseDir, { recursive: true, force: true })
    })

    it("archives active workflow and creates new when user answers new", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-active-new-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      await initializeWorkflow({
        workflowId: "active-task",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "正在进行的任务。",
      })
      await harness.stateStore.updateWorkflow("active-task", {
        phase: "develop",
        status: "in_progress",
      })

      // First call triggers the question
      await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "请帮我开发另一个功能。",
          mode: "safe",
        }),
      })

      // User answers "new"
      const newResult = await runner.run({
        harness,
        command: "workflow-answer",
        workflowId: "autopilot",
        payload: JSON.stringify({ lifecycle_decision: "new" }),
      })

      expect(newResult.ok).toBe(true)
      expect(newResult.output).toContain("已创建新的独立任务。")
      expect(newResult.output).toContain("Phase: spec_refinement")
      expect(newResult.output).not.toContain("Workflow: active-task\n")

      // Old workflow should be archived (marked as blocked/abandoned)
      const oldWorkflow = await harness.stateStore.getWorkflow("active-task")
      expect(oldWorkflow?.status).toBe("blocked")

      await rm(baseDir, { recursive: true, force: true })
    })

    it("accepts host-style answer payloads for lifecycle decisions", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-active-host-answer-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      await initializeWorkflow({
        workflowId: "active-task",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "正在进行的任务。",
      })
      await harness.stateStore.updateWorkflow("active-task", {
        phase: "test",
        status: "waiting_human",
      })

      await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "请帮我开发另一个功能。",
          mode: "safe",
        }),
      })

      const newResult = await runner.run({
        harness,
        command: "workflow-answer",
        workflowId: "autopilot",
        payload: JSON.stringify({ answer: "2" }),
      })

      expect(newResult.ok).toBe(true)
      expect(newResult.output).toContain("已创建新的独立任务。")
      expect(newResult.output).toContain("Phase: spec_refinement")
      expect(newResult.output).not.toContain("Workflow: active-task\n")

      await rm(baseDir, { recursive: true, force: true })
    })

    it("asks user even when active workflow is in waiting_human state", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-active-waiting-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      await initializeWorkflow({
        workflowId: "waiting-task",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "等待人工决策的任务。",
      })
      await harness.stateStore.updateWorkflow("waiting-task", {
        phase: "test",
        status: "waiting_human",
      })

      const result = await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "请帮我开发新功能。",
          mode: "debug",
        }),
      })

      expect(result.ok).toBe(true)
      expect(result.output).toContain("检测到未完成的工作流")
      expect(result.output).toContain("waiting-task")

      await rm(baseDir, { recursive: true, force: true })
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 3: Auto-cleanup of archived workflows
  // ═══════════════════════════════════════════

  describe("auto-cleanup keeps only last N completed workflows", () => {
    it("keeps only 3 most recent completed workflows after creating new one", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-cleanup-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      // Create 5 completed workflows with different timestamps
      for (let i = 1; i <= 5; i++) {
        await initializeWorkflow({
          workflowId: `completed-${i}`,
          stateStore: harness.stateStore,
          artifactEvaluator: harness.artifactEvaluator,
          userRequest: `任务 ${i}。`,
        })
        await harness.stateStore.updateWorkflow(`completed-${i}`, {
          phase: "done",
          status: "completed",
          updatedAt: new Date(Date.now() - (5 - i) * 60000).toISOString(),
        })
      }

      // New preset command should trigger cleanup
      const result = await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "新任务。",
          mode: "safe",
        }),
      })

      expect(result.ok).toBe(true)

      const workflows = await harness.stateStore.listWorkflows?.() ?? []
      const completedWorkflows = workflows.filter((w) => w.status === "completed")
      const activeWorkflows = workflows.filter((w) => w.status !== "completed")

      // Should keep at most 3 completed + the new active one
      expect(completedWorkflows.length).toBeLessThanOrEqual(3)
      expect(activeWorkflows.length).toBeGreaterThanOrEqual(1)

      // The 3 most recent completed should be kept (completed-3, completed-4, completed-5)
      const keptIds = completedWorkflows.map((w) => w.workflowId).sort()
      expect(keptIds).not.toContain("completed-1")
      expect(keptIds).not.toContain("completed-2")

      await rm(baseDir, { recursive: true, force: true })
    })

    it("does not delete workflows when fewer than keepCount exist", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-cleanup-few-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      // Create only 2 completed workflows
      for (let i = 1; i <= 2; i++) {
        await initializeWorkflow({
          workflowId: `completed-${i}`,
          stateStore: harness.stateStore,
          artifactEvaluator: harness.artifactEvaluator,
          userRequest: `任务 ${i}。`,
        })
        await harness.stateStore.updateWorkflow(`completed-${i}`, {
          phase: "done",
          status: "completed",
        })
      }

      await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "新任务。",
          mode: "safe",
        }),
      })

      const workflows = await harness.stateStore.listWorkflows?.() ?? []
      const completedWorkflows = workflows.filter((w) => w.status === "completed")
      expect(completedWorkflows.length).toBe(2)

      await rm(baseDir, { recursive: true, force: true })
    })

    it("also cleans up workflow directories from disk", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-cleanup-disk-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      for (let i = 1; i <= 5; i++) {
        await initializeWorkflow({
          workflowId: `completed-${i}`,
          stateStore: harness.stateStore,
          artifactEvaluator: harness.artifactEvaluator,
          userRequest: `任务 ${i}。`,
        })
        await harness.stateStore.updateWorkflow(`completed-${i}`, {
          phase: "done",
          status: "completed",
          updatedAt: new Date(Date.now() - (5 - i) * 60000).toISOString(),
        })
      }

      await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "新任务。",
          mode: "safe",
        }),
      })

      const dirs = await readdir(harness.workspace.workflowsRoot())
      expect(dirs).not.toContain("completed-1")
      expect(dirs).not.toContain("completed-2")

      await rm(baseDir, { recursive: true, force: true })
    })

    it("also cleans up archived-by-user workflows beyond the keep limit", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-cleanup-archived-by-user-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      for (let i = 1; i <= 5; i++) {
        await initializeWorkflow({
          workflowId: `archived-${i}`,
          stateStore: harness.stateStore,
          artifactEvaluator: harness.artifactEvaluator,
          userRequest: `归档任务 ${i}。`,
        })
        await harness.stateStore.updateWorkflow(`archived-${i}`, {
          phase: "develop",
          status: "blocked",
          blockReason: "archived-by-user",
          updatedAt: new Date(Date.now() - (5 - i) * 60_000).toISOString(),
        })
      }

      await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "新任务。",
          mode: "safe",
        }),
      })

      const workflows = await harness.stateStore.listWorkflows?.() ?? []
      const archivedByUser = workflows.filter((w) => w.status === "blocked" && w.blockReason === "archived-by-user")
      expect(archivedByUser.length).toBeLessThanOrEqual(3)

      await rm(baseDir, { recursive: true, force: true })
    })

    it("does not delete real blocked workflows during cleanup", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-cleanup-real-blocked-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      await initializeWorkflow({
        workflowId: "real-blocked",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "真实阻塞任务。",
      })
      await harness.stateStore.updateWorkflow("real-blocked", {
        phase: "blocked",
        status: "blocked",
        blockReason: "waiting_human",
      })

      for (let i = 1; i <= 5; i++) {
        await initializeWorkflow({
          workflowId: `completed-${i}`,
          stateStore: harness.stateStore,
          artifactEvaluator: harness.artifactEvaluator,
          userRequest: `已完成任务 ${i}。`,
        })
        await harness.stateStore.updateWorkflow(`completed-${i}`, {
          phase: "done",
          status: "completed",
          updatedAt: new Date(Date.now() - (5 - i) * 60_000).toISOString(),
        })
      }

      await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "新任务。",
          mode: "safe",
        }),
      })

      const realBlocked = await harness.stateStore.getWorkflow("real-blocked")
      expect(realBlocked?.status).toBe("blocked")
      expect(realBlocked?.blockReason).toBe("waiting_human")

      await rm(baseDir, { recursive: true, force: true })
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 4: Plugin-level e2e with tool calls
  // ═══════════════════════════════════════════

  describe("plugin-level lifecycle e2e", () => {
    it("full lifecycle: open → complete → open new → old archived", async () => {
      const workspaceDir = await mkdtemp(join(tmpdir(), "lifecycle-plugin-e2e-"))
      const loadPlugin = () => workflowPlugin({ directory: workspaceDir })
      const harness = await createHarness(join(workspaceDir, ".workflow-harness"))

      try {
        const plugin1 = await loadPlugin()

        // Start first workflow
        const openOutput = await plugin1.tool.workflow_open.execute({
          workflowId: "autopilot",
          payload: JSON.stringify({ prompt: "第一个任务。", mode: "safe" }),
        })
        expect(openOutput).toContain("Phase: spec_refinement")

        // Get the actual workflow id (derived)
        const workflows1 = await harness.stateStore.listWorkflows?.() ?? []
        const firstWorkflow = workflows1[0]
        expect(firstWorkflow).toBeDefined()

        // Simulate completion
        await harness.stateStore.updateWorkflow(firstWorkflow!.workflowId, {
          phase: "done",
          status: "completed",
        })

        // Start second workflow — should create new without asking (old is completed)
        const plugin2 = await loadPlugin()
        const secondOutput = await plugin2.tool.workflow_open.execute({
          workflowId: "autopilot",
          payload: JSON.stringify({ prompt: "第二个任务。", mode: "debug" }),
        })
        expect(secondOutput).toContain("Phase: spec_refinement")
        expect(secondOutput).toContain("已创建新的独立任务。")

        // Verify both exist
        const workflows2 = await harness.stateStore.listWorkflows?.() ?? []
        expect(workflows2.length).toBe(2)
      } finally {
        await rm(workspaceDir, { recursive: true, force: true })
      }
    })

    it("full lifecycle: open → interrupt → open again → asks user", async () => {
      const workspaceDir = await mkdtemp(join(tmpdir(), "lifecycle-plugin-interrupt-"))
      const loadPlugin = () => workflowPlugin({ directory: workspaceDir })
      const harness = await createHarness(join(workspaceDir, ".workflow-harness"))

      try {
        const plugin1 = await loadPlugin()

        // Start workflow
        const openOutput = await plugin1.tool.workflow_open.execute({
          workflowId: "autopilot",
          payload: JSON.stringify({ prompt: "正在做的任务。", mode: "safe" }),
        })
        expect(openOutput).toContain("Phase: spec_refinement")

        // Simulate interruption (workflow still in progress)
        // User comes back and tries to start again
        const plugin2 = await loadPlugin()
        const secondOutput = await plugin2.tool.workflow_open.execute({
          workflowId: "autopilot",
          payload: JSON.stringify({ prompt: "另一个任务。", mode: "safe" }),
        })

        // Should ask user
        expect(secondOutput).toContain("检测到未完成的工作流")
      } finally {
        await rm(workspaceDir, { recursive: true, force: true })
      }
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 5: Edge cases
  // ═══════════════════════════════════════════

  describe("edge cases", () => {
    it("handles blocked workflow as non-active (does not ask, creates new)", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-edge-blocked-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      await initializeWorkflow({
        workflowId: "blocked-task",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "已阻塞的任务。",
      })
      await harness.stateStore.updateWorkflow("blocked-task", {
        phase: "blocked",
        status: "blocked",
        blockReason: "unrecoverable",
      })

      const result = await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "新任务。",
          mode: "safe",
        }),
      })

      expect(result.ok).toBe(true)
      expect(result.output).toContain("已创建新的独立任务。")
      expect(result.output).not.toContain("检测到未完成的工作流")

      await rm(baseDir, { recursive: true, force: true })
    })

    it("non-preset commands (no mode) still use normal routing", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-edge-no-preset-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      const result = await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "default",
        payload: "为商品列表页新增价格排序下拉选择器。",
      })

      expect(result.ok).toBe(true)
      expect(result.output).toContain("Workflow:")
      expect(result.output).toContain("Phase: spec_refinement")

      await rm(baseDir, { recursive: true, force: true })
    })

    it("multiple active workflows — asks about the most recent one", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-edge-multi-active-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      await initializeWorkflow({
        workflowId: "task-old",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "旧任务。",
      })
      await harness.stateStore.updateWorkflow("task-old", {
        phase: "review",
        status: "in_progress",
        updatedAt: new Date(Date.now() - 60000).toISOString(),
      })

      await initializeWorkflow({
        workflowId: "task-new",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "新任务。",
      })
      await harness.stateStore.updateWorkflow("task-new", {
        phase: "develop",
        status: "in_progress",
        updatedAt: new Date().toISOString(),
      })

      const result = await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "又一个新任务。",
          mode: "verify",
        }),
      })

      expect(result.ok).toBe(true)
      expect(result.output).toContain("检测到未完成的工作流")
      // Should mention the most recent active one
      expect(result.output).toContain("task-new")

      await rm(baseDir, { recursive: true, force: true })
    })

    it("pending workflow (never started) is treated as active", async () => {
      const baseDir = await mkdtemp(join(tmpdir(), "lifecycle-edge-pending-"))
      const harness = await createHarness(baseDir)
      const runner = new DefaultWorkflowCommandRunner()

      await initializeWorkflow({
        workflowId: "pending-task",
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "还没开始的任务。",
      })

      const result = await runner.run({
        harness,
        command: "workflow-open",
        workflowId: "autopilot",
        payload: JSON.stringify({
          prompt: "新任务。",
          mode: "safe",
        }),
      })

      expect(result.ok).toBe(true)
      expect(result.output).toContain("检测到未完成的工作流")
      expect(result.output).toContain("pending-task")

      await rm(baseDir, { recursive: true, force: true })
    })
  })
})
