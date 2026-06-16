import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHarness } from "../packages/runtime/src/bootstrap/create-harness"
import { initializeWorkflow } from "../packages/runtime/src/bootstrap/initialize-workflow"
import workflowPlugin from "../packages/runtime/src/plugin/workflow-plugin-entry"

describe("workflow state recovery", () => {
  it("re-attaches with legacy sessions missing optional title field", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "workflow-state-recovery-"))
    const workflowId = "wf-legacy-session"
    const harnessDir = join(workspaceDir, ".workflow-harness")
    const plugin = await workflowPlugin({ directory: workspaceDir })

    try {
      const openOutput = await plugin.tool.workflow_open.execute({
        workflowId,
        payload: "新增会话恢复验证场景。",
      })
      expect(openOutput).toContain("Phase: spec_refinement")

      const answerOutput = await plugin.tool.workflow_answer.execute({
        workflowId,
        payload: JSON.stringify({ q_acceptance_criteria: "验收标准：attach 后仍可恢复到 develop 且状态保持一致。" }),
      })
      expect(answerOutput).toContain("Phase: plan")

      const planApprovalOutput = await plugin.tool.workflow_attach.execute({ workflowId })
      expect(planApprovalOutput).toContain("Phase: plan")
      expect(planApprovalOutput).toContain("Human action: Approval Required")

      const approveOutput = await plugin.tool.workflow_approve.execute({ workflowId })
      expect(approveOutput).toContain("Phase: develop")

      const sessionsFile = join(harnessDir, "workflows", workflowId, "sessions.json")
      const sessions = JSON.parse(await readFile(sessionsFile, "utf8")) as {
        sessions: Array<Record<string, unknown>>
      }
      sessions.sessions = sessions.sessions.map((session) => {
        const { title: _title, ...rest } = session
        return rest
      })
      await writeFile(sessionsFile, `${JSON.stringify(sessions, null, 2)}\n`, "utf8")

      const reloadedPlugin = await workflowPlugin({ directory: workspaceDir })
      const attachOutput = await reloadedPlugin.tool.workflow_attach.execute({ workflowId })

      expect(attachOutput).toContain("Workflow: wf-legacy-session")
      expect(attachOutput).toContain("Phase: develop")
      expect(attachOutput).toContain("Status: in_progress")

      const backOutput = await reloadedPlugin.tool.workflow_back.execute({ workflowId })
      expect(backOutput).toContain(`Returned from workflow channel for ${workflowId}`)
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  it("re-attaches with legacy review sidecar entries missing prompt hash metadata", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "workflow-state-recovery-sidecar-"))
    const workflowId = "wf-legacy-sidecar-done"
    const harnessDir = join(workspaceDir, ".workflow-harness")
    const harness = await createHarness(harnessDir)
    const plugin = await workflowPlugin({ directory: workspaceDir })

    try {
      await initializeWorkflow({
        workflowId,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "已完成的基础任务。",
      })
      await harness.stateStore.updateWorkflow(workflowId, {
        phase: "done",
        status: "completed",
        approved: true,
      })

      const nodeRunOutput = await plugin.tool.workflow_open.execute({
        workflowId,
        payload: JSON.stringify({
          prompt: "请从 review 角度更严格地检查这个改动。",
          mode: "review-heavy",
        }),
      })
      const nodeWorkflowId = nodeRunOutput.match(/Workflow: ([^\n]+)/)?.[1]?.trim()
      expect(nodeWorkflowId).toBeTruthy()

      const sidecarFile = join(harnessDir, "workflows", nodeWorkflowId!, "review-sidecar.json")
      const sidecar = JSON.parse(await readFile(sidecarFile, "utf8")) as {
        entries: Array<Record<string, unknown>>
      }
      sidecar.entries = sidecar.entries.map((entry) => {
        const { promptHash: _promptHash, promptLength: _promptLength, lastSummaryHash: _lastSummaryHash, ...rest } = entry
        return rest
      })
      await writeFile(sidecarFile, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8")
      await writeFile(
        harness.workspace.phaseArtifactFile(nodeWorkflowId!, "review"),
        [
          "# 审查报告",
          "",
          "## 状态",
          "待判定",
          "",
          "## 结论",
          "待判定",
          "",
          "## 报告语言",
          "中文",
        ].join("\n"),
        "utf8",
      )

      const reloadedPlugin = await workflowPlugin({ directory: workspaceDir })
      const attachOutput = await reloadedPlugin.tool.workflow_attach.execute({ workflowId: nodeWorkflowId! })

      expect(attachOutput).toContain(`Workflow: ${nodeWorkflowId!}`)
      expect(attachOutput).toContain("Review sidecar entries:")
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})
