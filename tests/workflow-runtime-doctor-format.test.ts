import { describe, expect, it } from "bun:test"
import { formatWorkflowRuntimeDoctorResult } from "../packages/runtime/src/diagnostics/workflow-runtime-doctor-format"

describe("workflow runtime doctor formatter", () => {
  it("formats the minimal reason and recommendation output", () => {
    const output = formatWorkflowRuntimeDoctorResult({
      ok: false,
      workflowId: "wf-1",
      status: "abnormal",
      reason: "develop artifact still looks like a template",
      recommendation: "Finish develop.md and rerun workflow_attach.",
      recommendedTool: "workflow_attach",
    })

    expect(output).toContain("状态：异常")
    expect(output).toContain("原因：develop artifact still looks like a template")
    expect(output).toContain("建议：Finish develop.md and rerun workflow_attach.")
  })
})
