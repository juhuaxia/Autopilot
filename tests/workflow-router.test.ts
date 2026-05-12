import { describe, expect, it } from "bun:test"
import {
  classifyWorkflowIntent,
  formatRoutingOutput,
  generateDerivedWorkflowId,
} from "../packages/runtime/src/commands/workflow-router"
import type { WorkflowState } from "../packages/core/src/state/workflow-state"

function makeWorkflow(overrides: Partial<WorkflowState> & { workflowId: string }): WorkflowState {
  return {
    phase: "spec_refinement",
    status: "in_progress",
    approved: false,
    iteration: 0,
    maxIterations: 3,
    blockReason: null,
    activeSessionId: null,
    phaseEnteredAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

const DONE_WORKFLOW = makeWorkflow({
  workflowId: "artifact-heading-parser-fix",
  phase: "done",
  status: "completed",
})

const IN_PROGRESS_WORKFLOW = makeWorkflow({
  workflowId: "workflow-auto-routing",
  phase: "develop",
  status: "in_progress",
})

function baseInput(payload: string, overrides: Partial<Parameters<typeof classifyWorkflowIntent>[0]> = {}) {
  return {
    rawPayload: payload,
    prompt: payload,
    requestedWorkflowId: "default",
    activeWorkflows: [],
    primaryWorkflow: null,
    hasPendingHumanAction: false,
    ...overrides,
  }
}

describe("workflow auto-router — classifyWorkflowIntent", () => {

  // ═══════════════════════════════════════════
  // Scenario 1: Hard continuation signals → continue
  // ═══════════════════════════════════════════

  describe("hard continuation signals", () => {
    it("'继续' with in-progress workflow → continue", () => {
      const result = classifyWorkflowIntent(baseInput("继续", {
        activeWorkflows: [IN_PROGRESS_WORKFLOW],
        primaryWorkflow: IN_PROGRESS_WORKFLOW,
      }))
      expect(result.action).toBe("continue")
      expect(result.targetWorkflowId).toBe("workflow-auto-routing")
    })

    it("'继续下一步' → continue", () => {
      const result = classifyWorkflowIntent(baseInput("继续下一步", {
        activeWorkflows: [IN_PROGRESS_WORKFLOW],
        primaryWorkflow: IN_PROGRESS_WORKFLOW,
      }))
      expect(result.action).toBe("continue")
    })

    it("'批准' with pending human action → continue", () => {
      const result = classifyWorkflowIntent(baseInput("批准", {
        activeWorkflows: [IN_PROGRESS_WORKFLOW],
        primaryWorkflow: IN_PROGRESS_WORKFLOW,
        hasPendingHumanAction: true,
        pendingHumanActionWorkflowId: "workflow-auto-routing",
      }))
      expect(result.action).toBe("continue")
      expect(result.targetWorkflowId).toBe("workflow-auto-routing")
    })

    it("'同意' → continue", () => {
      const result = classifyWorkflowIntent(baseInput("同意", {
        activeWorkflows: [IN_PROGRESS_WORKFLOW],
        primaryWorkflow: IN_PROGRESS_WORKFLOW,
        hasPendingHumanAction: true,
        pendingHumanActionWorkflowId: "workflow-auto-routing",
      }))
      expect(result.action).toBe("continue")
    })

    it("'修 review 里的问题' → continue (phase-specific)", () => {
      const result = classifyWorkflowIntent(baseInput("修 review 里的问题", {
        activeWorkflows: [IN_PROGRESS_WORKFLOW],
        primaryWorkflow: IN_PROGRESS_WORKFLOW,
      }))
      expect(result.action).toBe("continue")
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 2: New requirement signals → new
  // ═══════════════════════════════════════════

  describe("new requirement signals", () => {
    it("'新需求：xxx' → new", () => {
      const result = classifyWorkflowIntent(baseInput("新需求：重写 README"))
      expect(result.action).toBe("new")
      expect(result.targetWorkflowId).toBeDefined()
    })

    it("'另外帮我改一下 README' → new", () => {
      const result = classifyWorkflowIntent(baseInput("另外帮我改一下 README"))
      expect(result.action).toBe("new")
    })

    it("'再做一个 routing 功能' → new", () => {
      const result = classifyWorkflowIntent(baseInput("再做一个 routing 功能"))
      expect(result.action).toBe("new")
    })

    it("new requirement pattern overrides continuation when done workflow exists", () => {
      const result = classifyWorkflowIntent(baseInput("新需求：发布到 npm", {
        activeWorkflows: [DONE_WORKFLOW],
        primaryWorkflow: DONE_WORKFLOW,
      }))
      expect(result.action).toBe("new")
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 3: Follow-up iteration signals → fork
  // ═══════════════════════════════════════════

  describe("follow-up iteration signals", () => {
    it("'刚才那个修复再补一个 edge case' on completed workflow → fork", () => {
      const result = classifyWorkflowIntent(baseInput("刚才那个修复再补一个 edge case", {
        activeWorkflows: [DONE_WORKFLOW],
        primaryWorkflow: DONE_WORKFLOW,
      }))
      expect(result.action).toBe("fork")
      expect(result.parentWorkflowId).toBe("artifact-heading-parser-fix")
      expect(result.targetWorkflowId).toContain("followup")
    })

    it("'这个功能再做一轮增强' on completed workflow → fork", () => {
      const result = classifyWorkflowIntent(baseInput("这个功能再做一轮增强", {
        activeWorkflows: [DONE_WORKFLOW],
        primaryWorkflow: DONE_WORKFLOW,
      }))
      expect(result.action).toBe("fork")
    })

    it("follow-up pattern on in-progress workflow → continue (conservative)", () => {
      const result = classifyWorkflowIntent(baseInput("再补一个测试用例", {
        activeWorkflows: [IN_PROGRESS_WORKFLOW],
        primaryWorkflow: IN_PROGRESS_WORKFLOW,
      }))
      expect(result.action).toBe("continue")
    })

    it("follow-up pattern with no active workflows → new", () => {
      const result = classifyWorkflowIntent(baseInput("在此基础上扩展能力"))
      expect(result.action).toBe("new")
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 4: Ambiguous signals → confirm
  // ═══════════════════════════════════════════

  describe("ambiguous signals", () => {
    it("'这个再改一下' → confirm", () => {
      const result = classifyWorkflowIntent(baseInput("这个再改一下"))
      expect(result.action).toBe("confirm")
    })

    it("'还有个问题' → confirm", () => {
      const result = classifyWorkflowIntent(baseInput("还有个问题"))
      expect(result.action).toBe("confirm")
    })

    it("'顺便处理一下' → confirm", () => {
      const result = classifyWorkflowIntent(baseInput("顺便处理一下"))
      expect(result.action).toBe("confirm")
    })

    it("ambiguous on completed workflow → confirm", () => {
      const result = classifyWorkflowIntent(baseInput("再调整下", {
        activeWorkflows: [DONE_WORKFLOW],
        primaryWorkflow: DONE_WORKFLOW,
      }))
      expect(result.action).toBe("confirm")
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 5: Negation handling
  // ═════════════════════════════════════════

  describe("negation handling", () => {
    it("'不要继续' → confirm (not continue)", () => {
      const result = classifyWorkflowIntent(baseInput("不要继续", {
        activeWorkflows: [IN_PROGRESS_WORKFLOW],
        primaryWorkflow: IN_PROGRESS_WORKFLOW,
      }))
      expect(result.action).toBe("confirm")
    })

    it("'别继续做' → confirm", () => {
      const result = classifyWorkflowIntent(baseInput("别继续做", {
        activeWorkflows: [IN_PROGRESS_WORKFLOW],
        primaryWorkflow: IN_PROGRESS_WORKFLOW,
      }))
      expect(result.action).toBe("confirm")
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 6: Default / fallback behavior
  // ═════════════════════════════════════════

  describe("default behavior", () => {
    it("no active workflow + non-trivial input → new", () => {
      const result = classifyWorkflowIntent(baseInput("实现用户认证功能"))
      expect(result.action).toBe("new")
    })

    it("active in-progress workflow + no strong signal → continue", () => {
      const result = classifyWorkflowIntent(baseInput("看一下代码", {
        activeWorkflows: [IN_PROGRESS_WORKFLOW],
        primaryWorkflow: IN_PROGRESS_WORKFLOW,
      }))
      expect(result.action).toBe("continue")
    })

    it("empty payload → confirm", () => {
      const result = classifyWorkflowIntent(baseInput(""))
      expect(result.action).toBe("confirm")
    })

    it("completed workflow only + non-trivial → confirm", () => {
      const result = classifyWorkflowIntent(baseInput("接下来做什么", {
        activeWorkflows: [DONE_WORKFLOW],
        primaryWorkflow: DONE_WORKFLOW,
      }))
      expect(result.action).toBe("confirm")
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 7: Edge cases
  // ═════════════════════════════════════════

  describe("edge cases", () => {
    it("very long payload (>2000 chars) → confirm", () => {
      const longPayload = "a".repeat(2001)
      const result = classifyWorkflowIntent(baseInput(longPayload))
      expect(result.action).toBe("confirm")
    })

    it("JSON answer to pending human action → continue", () => {
      const jsonAnswer = '{"q_acceptance_criteria":"done"}'
      const result = classifyWorkflowIntent(baseInput(jsonAnswer, {
        activeWorkflows: [IN_PROGRESS_WORKFLOW],
        primaryWorkflow: IN_PROGRESS_WORKFLOW,
        hasPendingHumanAction: true,
        pendingHumanActionWorkflowId: "workflow-auto-routing",
      }))
      expect(result.action).toBe("continue")
    })
  })
})

describe("formatRoutingOutput", () => {
  it("continue action returns simple message", () => {
    expect(formatRoutingOutput({ action: "continue", reason: "test" })).toContain("已继续当前任务")
  })

  it("new action returns new task message", () => {
    expect(formatRoutingOutput({ action: "new", reason: "test" })).toContain("新的独立任务")
  })

  it("fork action includes parent and child IDs", () => {
    const output = formatRoutingOutput({
      action: "fork",
      reason: "test",
      targetWorkflowId: "child-1",
      parentWorkflowId: "parent-1",
    })
    expect(output).toContain("后续任务")
    expect(output).toContain("parent-1")
    expect(output).toContain("child-1")
  })

  it("confirm action shows options", () => {
    const output = formatRoutingOutput({ action: "confirm", reason: "test" })
    expect(output).toContain("请确认你的意图")
    expect(output).toContain("继续当前任务")
    expect(output).toContain("创建新的独立任务")
    expect(output).toContain("派生后续任务")
  })
})

describe("generateDerivedWorkflowId", () => {
  it("fork suffix contains 'followup'", () => {
    const id = generateDerivedWorkflowId("my-workflow", "fork")
    expect(id).toContain("followup")
    expect(id).not.toBe("my-workflow")
  })

  it("new suffix is a timestamp", () => {
    const id = generateDerivedWorkflowId("my-workflow", "new")
    expect(id.startsWith("my-workflow-"))
    expect(id).not.toContain("followup")
  })

  it("does not double-suffix if already suffixed", () => {
    const id = generateDerivedWorkflowId("my-workflow-followup-abc", "fork")
    expect(id).toBe("my-workflow-followup-abc")
  })
})
