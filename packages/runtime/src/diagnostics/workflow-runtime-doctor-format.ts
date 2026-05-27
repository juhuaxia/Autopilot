import type { WorkflowRuntimeDoctorResult } from "./workflow-runtime-doctor"

export function formatWorkflowRuntimeDoctorResult(result: WorkflowRuntimeDoctorResult): string {
  return [
    `状态：${result.status === "abnormal" ? "异常" : "正常"}`,
    `原因：${result.reason}`,
    `建议：${result.recommendation}`,
  ].join("\n")
}
