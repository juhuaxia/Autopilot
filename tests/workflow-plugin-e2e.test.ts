import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHarness } from "../packages/runtime/src/bootstrap/create-harness"
import workflowPlugin from "../packages/runtime/src/plugin/workflow-plugin-entry"

describe("workflow plugin e2e", () => {
  it("drives a workflow across plugin reloads through answer approval back attach resume and completion", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "workflow-plugin-e2e-"))
    const workflowId = "wf-plugin-e2e"
    const loadPlugin = () => workflowPlugin({ directory: workspaceDir })
    const harness = await createHarness(join(workspaceDir, ".workflow-harness"))

    try {
      const plugin1 = await loadPlugin()
      const openOutput = await plugin1.tool.workflow_open.execute({
        workflowId,
        payload: "新增工作流插件端到端恢复与推进验证。",
      })
      expect(openOutput).toContain("Phase: spec_refinement")
      expect(openOutput).toContain("Status: in_progress")
      expect(openOutput).toContain("Human action: none")

      const refinementQuestionOutput = await plugin1.tool.workflow_attach.execute({ workflowId })
      expect(refinementQuestionOutput).toContain("Phase: spec_refinement")
      expect(refinementQuestionOutput).toContain("Human action: Answer Required")

      const answerOutput = await plugin1.tool.workflow_answer.execute({
        workflowId,
        payload: JSON.stringify({ q_acceptance_criteria: "验收标准：跨插件重载后 workflow 仍可推进到 done。" }),
      })
      expect(answerOutput).toContain("Phase: plan")
      expect(["Status: in_progress", "Status: waiting_human"].some((marker) => answerOutput.includes(marker))).toBe(true)

      const planApprovalOutput = await plugin1.tool.workflow_attach.execute({ workflowId })
      expect(planApprovalOutput).toContain("Phase: plan")
      expect(planApprovalOutput).toContain("Human action: Approval Required")

      const plugin2 = await loadPlugin()
      const approveOutput = await plugin2.tool.workflow_approve.execute({ workflowId })
      expect(approveOutput).toContain("Phase: develop")
      expect(approveOutput).toMatch(/Status: (in_progress|waiting_human)/)

      const backOutput = await plugin2.tool.workflow_back.execute({ workflowId })
      expect(backOutput).toContain(`Returned from workflow channel for ${workflowId}`)

      const plugin3 = await loadPlugin()
      const attachDevelopOutput = await plugin3.tool.workflow_attach.execute({ workflowId })
      expect(attachDevelopOutput).toContain("Phase: develop")

      await harness.artifactEvaluator.markDevelopmentComplete(workflowId)

      const plugin4 = await loadPlugin()
      const reviewRunningOutput = await plugin4.tool.workflow_attach.execute({ workflowId })
      expect(reviewRunningOutput).toContain("Phase: review")
      expect(reviewRunningOutput).toContain("Status: in_progress")

      const reviewStatusOutput = await plugin4.tool.workflow_status.execute({ workflowId })
      expect(reviewStatusOutput).toContain("Phase: review")

      await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)

      const plugin5 = await loadPlugin()
      const testRunningOutput = await plugin5.tool.workflow_attach.execute({ workflowId })
      expect(testRunningOutput).toContain("Phase: test")
      expect(testRunningOutput).toContain("Status: in_progress")

      await harness.artifactEvaluator.setTestReport(workflowId, "fail")

      const plugin6 = await loadPlugin()
      const blockedOutput = await plugin6.tool.workflow_attach.execute({ workflowId })
      expect(blockedOutput).toContain("Phase: test")
      expect(blockedOutput).toContain("Status: waiting_human")
      expect(blockedOutput).toContain("Human action: Manual Decision Required")

      const blockedBackOutput = await plugin6.tool.workflow_back.execute({ workflowId })
      expect(blockedBackOutput).toContain(`Returned from workflow channel for ${workflowId}`)

      await harness.artifactEvaluator.setTestReport(workflowId, "pass")

      const plugin7 = await loadPlugin()
      const resumeOutput = await plugin7.tool.workflow_resume.execute({ workflowId })
      expect(resumeOutput).toContain("Phase: done")
      expect(resumeOutput).toContain("Status: completed")

      const plugin8 = await loadPlugin()
      const finalOutput = await plugin8.tool.workflow_attach.execute({ workflowId })
      expect(finalOutput).toContain("Phase: done")
      expect(finalOutput).toContain("Status: completed")
      expect(finalOutput).toContain("Human action: none")
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  it("does not report done when test artifact remains unresolved across reloads", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "workflow-plugin-test-unresolved-"))
    const workflowId = "wf-plugin-test-unresolved"
    const loadPlugin = () => workflowPlugin({ directory: workspaceDir })
    const harness = await createHarness(join(workspaceDir, ".workflow-harness"))

    try {
      const plugin1 = await loadPlugin()
      await plugin1.tool.workflow_open.execute({
        workflowId,
        payload: "新增 test 未判定不得 done 的插件回归验证。",
      })
      await plugin1.tool.workflow_answer.execute({
        workflowId,
        payload: JSON.stringify({ q_acceptance_criteria: "验收标准：workflow 需要完整经过 refinement、plan、develop、review、test；当 test 报告仍未形成明确 PASS/FAIL 结论或仍处于草稿态时不能进入 done。" }),
      })
      const planOutput = await plugin1.tool.workflow_attach.execute({ workflowId })
      expect(planOutput).toContain("Phase: plan")
      await plugin1.tool.workflow_approve.execute({ workflowId })

      await harness.artifactEvaluator.markDevelopmentComplete(workflowId)

      const plugin2 = await loadPlugin()
      const reviewOutput = await plugin2.tool.workflow_attach.execute({ workflowId })
      expect(reviewOutput).toContain("Phase: review")

      await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)

      const plugin3 = await loadPlugin()
      const testOutput = await plugin3.tool.workflow_attach.execute({ workflowId })
      expect(testOutput).toContain("Phase: test")

      await Bun.write(
        harness.workspace.phaseArtifactFile(workflowId, "test"),
        [
          "# 测试报告",
          "",
          "## 状态",
          "COMPLETED",
          "",
          "## 轮次",
          "第 1 轮",
          "",
          "## 测试策略",
          "待判定",
          "",
          "## 验证范围",
          "待判定",
          "",
          "## 测试概要",
          "待判定",
          "",
          "## 测试证据",
          "待判定",
          "",
          "## 新增页面专项验证（如适用）",
          "待判定",
          "",
          "## Figma 高保真验证（如适用）",
          "待判定",
          "",
          "## Key Visual Elements 验证（如适用）",
          "待判定",
          "",
          "## 失败项",
          "待判定",
          "",
          "## 历史遗留观察项（非阻塞，可选）",
          "待判定",
          "",
          "## Regression 验证",
          "待判定",
          "",
          "## 覆盖范围",
          "待判定",
          "",
          "## 开发者决策建议",
          "待判定",
          "",
          "## 结论",
          "待判定",
          "",
          "## 报告语言",
          "中文",
        ].join("\n"),
      )

      const plugin4 = await loadPlugin()
      const unresolvedOutput = await plugin4.tool.workflow_attach.execute({ workflowId })
      expect(unresolvedOutput).toContain("Phase: test")
      expect(unresolvedOutput).not.toContain("Phase: done")
      expect(unresolvedOutput).not.toContain("Status: completed")
    } finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})
