import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
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
})
