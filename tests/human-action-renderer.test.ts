import { describe, expect, it } from "bun:test"
import { renderHumanActionBlock } from "../packages/runtime/src/presentation/human-action-renderer"
import type { HumanActionRecord } from "../packages/core/src/human-actions/human-action-record"
import type { WorkflowRuntimeState } from "../packages/core/src/state/workflow-runtime-state"
import type { WorkflowState } from "../packages/core/src/state/workflow-state"

describe("human action renderer", () => {
  it("renders structured answer-required block", () => {
    const workflow: WorkflowState = {
      workflowId: "wf-render",
      phase: "spec_refinement",
      status: "waiting_human",
      approved: false,
      iteration: 0,
      maxIterations: 3,
      blockReason: null,
      activeSessionId: null,
      phaseEnteredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const runtime: WorkflowRuntimeState = {
      workflowId: workflow.workflowId,
      recoveryState: "idle",
      waitingHumanActionId: "action-1",
      consecutiveFailures: 0,
    }
    const humanAction: HumanActionRecord = {
      id: "action-1",
      workflowId: workflow.workflowId,
      status: "presented",
      createdAt: new Date().toISOString(),
      action: {
        type: "need_answers",
        workflowId: workflow.workflowId,
        phase: workflow.phase,
        reason: "Questions must be answered before continuing",
        required: true,
        createdAt: new Date().toISOString(),
        summary: "规格精炼报告未满足进入 plan 的要求",
        questions: [
            {
              id: "q_acceptance_criteria",
              priority: "required",
              text: "请确认本次需求的具体验收标准或完成定义。",
              canAutoResolve: false,
              suggestedAnswer: "请补充可验证的验收标准，例如页面行为、交互结果或完成定义。",
            },
          ],
        },
    }

    const output = renderHumanActionBlock({ workflow, runtime, humanAction })

    expect(output).toContain("Workflow: wf-render")
    expect(output).toContain("Progress:")
    expect(output).toContain("[~] Refinement")
    expect(output).toContain("Human action: Answer Required")
    expect(output).toContain("Questions:")
    expect(output).toContain("Recommended tool: workflow_answer")
    expect(output).toContain('Recommended payload: {"q_acceptance_criteria":"请补充可验证的验收标准，例如页面行为、交互结果或完成定义。"}')
    expect(output).toContain("Exact action: Run: bun run src/cli.ts answer wf-render")
  })

  it("renders no-human-action state cleanly", () => {
    const workflow: WorkflowState = {
      workflowId: "wf-none",
      phase: "develop",
      status: "in_progress",
      approved: true,
      iteration: 1,
      maxIterations: 3,
      blockReason: null,
      activeSessionId: "session-1",
      phaseEnteredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const output = renderHumanActionBlock({
      workflow,
      runtime: null,
      humanAction: null,
      phaseDetails: ["Phase summary: Development work is not complete yet", "Code changes: packages/foo.ts"],
    })

    expect(output).toContain("Human action: none")
    expect(output).toContain("Details:")
    expect(output).toContain("Code changes: packages/foo.ts")
    expect(output).toContain("Recommended tool: workflow_attach")
    expect(output).toContain("workflow is still running or waiting for the next attach-driven continuation")
    expect(output).toContain("Exact action: Re-run workflow_attach for wf-none")
    expect(output).toContain("Agent hint: if you are the workflow main agent")
    expect(output).toContain("Phase: develop")
    expect(output).toContain("[x] Plan")
    expect(output).toContain("[~] Develop")
  })

  it("renders approval and resume recommendations", () => {
    const workflow: WorkflowState = {
      workflowId: "wf-approve",
      phase: "plan",
      status: "waiting_human",
      approved: false,
      iteration: 0,
      maxIterations: 3,
      blockReason: null,
      activeSessionId: null,
      phaseEnteredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const approvalAction: HumanActionRecord = {
      id: "action-approval",
      workflowId: workflow.workflowId,
      status: "presented",
      createdAt: new Date().toISOString(),
      action: {
        type: "need_approval",
        workflowId: workflow.workflowId,
        phase: "plan",
        reason: "Plan is ready",
        required: true,
        createdAt: new Date().toISOString(),
      },
    }
    const blockedAction: HumanActionRecord = {
      ...approvalAction,
      id: "action-blocked",
      action: {
        type: "blocked",
        workflowId: workflow.workflowId,
        phase: "test",
        reason: "Test failed",
        required: true,
        createdAt: new Date().toISOString(),
      },
    }

    expect(renderHumanActionBlock({ workflow, runtime: null, humanAction: approvalAction }))
      .toContain("Recommended tool: workflow_approve")
    expect(renderHumanActionBlock({ workflow, runtime: null, humanAction: blockedAction }))
      .toContain("Recommended tool: workflow_resume")
  })
})
