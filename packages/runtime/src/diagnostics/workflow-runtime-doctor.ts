import type { WorkflowRuntimeState } from "../../../core/src/state/workflow-runtime-state"
import type { WorkflowState } from "../../../core/src/state/workflow-state"
import type { HumanActionRecord } from "../../../core/src/human-actions/human-action-record"
import type { createHarness } from "../bootstrap/create-harness"
import { FileSystemWorkflowEventStore } from "../events/file-system-workflow-event-store"
import { FileSystemHumanActionStore } from "../state/file-system-human-action-store"
import { FileSystemWorkflowStateStore } from "../state/file-system-workflow-state-store"
import { readJsonFile } from "../shared/json-file"
import { DefaultWorkflowWorkspace } from "../workspace/workflow-workspace"

type Harness = Awaited<ReturnType<typeof createHarness>>

type ArtifactStateSnapshot = Partial<Record<string, {
  missing?: string[]
  summary?: string
}>>

export type WorkflowRuntimeDoctorResult = {
  ok: boolean
  workflowId: string
  status: "normal" | "abnormal"
  reason: string
  recommendation: string
  recommendedTool?: "workflow_attach" | "workflow_resume" | "workflow_resync" | "workflow_status"
}

function minutesSince(isoTime: string | undefined): number | null {
  if (!isoTime) {
    return null
  }
  const time = new Date(isoTime).getTime()
  if (Number.isNaN(time)) {
    return null
  }
  return (Date.now() - time) / 60_000
}

function detectBlocked(args: {
  workflow: WorkflowState
  runtime: WorkflowRuntimeState | null
  humanAction: HumanActionRecord | null
}): WorkflowRuntimeDoctorResult | null {
  const { workflow, runtime, humanAction } = args
  const blockedFromPhase = runtime?.blockedFromPhase
  if (workflow.status !== "blocked" && humanAction?.action.type !== "blocked") {
    return null
  }
  if (blockedFromPhase === "review" || blockedFromPhase === "test") {
    return {
      ok: false,
      workflowId: workflow.workflowId,
      status: "abnormal",
      reason: `workflow blocked from ${blockedFromPhase} and is waiting for a manual decision`,
      recommendation: `Use workflow_resume with payload fix to return to develop, or workflow_resync if you want to rerun ${blockedFromPhase} against out-of-band edits.`,
      recommendedTool: "workflow_resume",
    }
  }
  return {
    ok: false,
    workflowId: workflow.workflowId,
    status: "abnormal",
    reason: workflow.blockReason?.trim() || "workflow is blocked and waiting for external intervention",
    recommendation: `Use workflow_status for ${workflow.workflowId} to inspect the blocked state before choosing the next action.`,
    recommendedTool: "workflow_status",
  }
}

function detectArtifactRepair(args: {
  workflow: WorkflowState
  runtime: WorkflowRuntimeState | null
  artifactMissing: string[]
  repairEventPresent: boolean
}): WorkflowRuntimeDoctorResult | null {
  const { workflow, runtime, artifactMissing, repairEventPresent } = args
  const repairPending = workflow.phase === "develop"
    ? runtime?.developArtifactRepairDispatchPending === true
    : workflow.phase === "review"
      ? runtime?.reviewArtifactRepairDispatchPending === true
      : workflow.phase === "test"
        ? runtime?.testArtifactRepairDispatchPending === true
        : false
  if (!repairPending && !artifactMissing.includes("artifact_unchanged_from_template") && !repairEventPresent) {
    return null
  }
  return {
    ok: false,
    workflowId: workflow.workflowId,
    status: "abnormal",
    reason: `${workflow.phase} artifact still looks like a template or incomplete artifact repair`,
    recommendation: `Do not use workflow_resume. Finish the ${workflow.phase}.md artifact with real results, then rerun workflow_attach.`,
    recommendedTool: "workflow_attach",
  }
}

function detectStuck(args: {
  workflow: WorkflowState
  runtime: WorkflowRuntimeState | null
  humanAction: HumanActionRecord | null
}): WorkflowRuntimeDoctorResult | null {
  const { workflow, runtime, humanAction } = args
  if (workflow.status !== "in_progress" || humanAction) {
    return null
  }
  const updatedMinutes = minutesSince(workflow.updatedAt)
  const continuedMinutes = minutesSince(runtime?.lastContinuationAt)
  const staleMinutes = Math.max(updatedMinutes ?? 0, continuedMinutes ?? 0)
  if (staleMinutes < 10) {
    return null
  }
  return {
    ok: false,
    workflowId: workflow.workflowId,
    status: "abnormal",
    reason: `workflow appears stuck with no visible progress for about ${Math.floor(staleMinutes)} minutes`,
    recommendation: `Rerun workflow_attach for ${workflow.workflowId}. If the workflow still does not move, inspect workflow_status for the current phase details.`,
    recommendedTool: "workflow_attach",
  }
}

export async function runWorkflowRuntimeDoctor(args: {
  harness: Harness
  workflowId: string
}): Promise<WorkflowRuntimeDoctorResult> {
  const workflow = await args.harness.stateStore.getWorkflow(args.workflowId)
  if (!workflow) {
    return {
      ok: false,
      workflowId: args.workflowId,
      status: "abnormal",
      reason: `workflow not found: ${args.workflowId}`,
      recommendation: "Check the workflowId and rerun workflow_open or workflow_status with an existing workflow.",
      recommendedTool: "workflow_status",
    }
  }

  const runtime = await args.harness.stateStore.getRuntime(args.workflowId)
  const humanAction = await args.harness.humanActionStore.getCurrent(args.workflowId)
  const artifactState = await readJsonFile<ArtifactStateSnapshot>(args.harness.workspace.artifactStateFile(args.workflowId))
  const artifactMissing = artifactState?.[workflow.phase]?.missing ?? []
  const events = await args.harness.eventStore.list(args.workflowId).catch(() => [])
  const repairEventPresent = events.some((event) => event.type === "artifact.repair_dispatched" || event.type === "artifact.repair_blocked")

  return detectBlocked({ workflow, runtime, humanAction })
    ?? detectArtifactRepair({ workflow, runtime, artifactMissing, repairEventPresent })
    ?? detectStuck({ workflow, runtime, humanAction })
    ?? {
      ok: true,
      workflowId: args.workflowId,
      status: "normal",
      reason: "no abnormal workflow state detected",
      recommendation: `Continue with workflow_attach for ${args.workflowId}.`,
      recommendedTool: "workflow_attach",
    }
}

export async function runWorkflowRuntimeDoctorFromBaseDir(args: {
  baseDir: string
  workflowId: string
}): Promise<WorkflowRuntimeDoctorResult> {
  const workspace = new DefaultWorkflowWorkspace(args.baseDir)
  const stateStore = new FileSystemWorkflowStateStore(workspace)
  const humanActionStore = new FileSystemHumanActionStore(workspace)
  const eventStore = new FileSystemWorkflowEventStore(workspace)
  const workflow = await stateStore.getWorkflow(args.workflowId)

  if (!workflow) {
    return {
      ok: false,
      workflowId: args.workflowId,
      status: "abnormal",
      reason: `workflow not found: ${args.workflowId}`,
      recommendation: "Check the workflowId and rerun workflow_open or workflow_status with an existing workflow.",
      recommendedTool: "workflow_status",
    }
  }

  const runtime = await stateStore.getRuntime(args.workflowId)
  const humanAction = await humanActionStore.getCurrent(args.workflowId)
  const events = await eventStore.list(args.workflowId).catch(() => [])
  const artifactState = await readJsonFile<ArtifactStateSnapshot>(workspace.artifactStateFile(args.workflowId))
  const artifactMissing = artifactState?.[workflow.phase]?.missing ?? []
  const repairEventPresent = events.some((event) => event.type === "artifact.repair_dispatched" || event.type === "artifact.repair_blocked")

  return detectBlocked({ workflow, runtime, humanAction })
    ?? detectArtifactRepair({ workflow, runtime, artifactMissing, repairEventPresent })
    ?? detectStuck({ workflow, runtime, humanAction })
    ?? {
      ok: true,
      workflowId: args.workflowId,
      status: "normal",
      reason: "no abnormal workflow state detected",
      recommendation: `Continue with workflow_attach for ${args.workflowId}.`,
      recommendedTool: "workflow_attach",
    }
}
