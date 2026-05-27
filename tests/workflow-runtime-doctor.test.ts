import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHarness } from "../packages/runtime/src/bootstrap/create-harness"
import { initializeWorkflow } from "../packages/runtime/src/bootstrap/initialize-workflow"
import { runWorkflowRuntimeDoctor, runWorkflowRuntimeDoctorFromBaseDir } from "../packages/runtime/src/diagnostics/workflow-runtime-doctor"

describe("workflow runtime doctor", () => {
  it("diagnoses blocked review/test workflows", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-runtime-doctor-blocked-"))
    const harness = await createHarness(baseDir)
    const workflowId = "wf-doctor-blocked"

    await initializeWorkflow({ workflowId, stateStore: harness.stateStore, artifactEvaluator: harness.artifactEvaluator, userRequest: "blocked doctor" })
    await harness.stateStore.updateWorkflow(workflowId, {
      phase: "blocked",
      status: "blocked",
      blockReason: "Review failed and needs manual decision",
    })
    await harness.stateStore.updateRuntime(workflowId, {
      blockedFromPhase: "review",
    })

    const result = await runWorkflowRuntimeDoctor({ harness, workflowId })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("blocked from review")
    expect(result.recommendation).toContain("workflow_resume")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("diagnoses artifact repair loops", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-runtime-doctor-artifact-"))
    const harness = await createHarness(baseDir)
    const workflowId = "wf-doctor-artifact"

    await initializeWorkflow({ workflowId, stateStore: harness.stateStore, artifactEvaluator: harness.artifactEvaluator, userRequest: "artifact doctor" })
    await harness.stateStore.updateWorkflow(workflowId, {
      phase: "develop",
      status: "in_progress",
    })
    await harness.stateStore.updateRuntime(workflowId, {
      developArtifactRepairDispatchPending: true,
    })

    const result = await runWorkflowRuntimeDoctor({ harness, workflowId })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("develop artifact")
    expect(result.recommendation).toContain("Do not use workflow_resume")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("returns normal when no abnormal state is detected", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-runtime-doctor-normal-"))
    const harness = await createHarness(baseDir)
    const workflowId = "wf-doctor-normal"

    await initializeWorkflow({ workflowId, stateStore: harness.stateStore, artifactEvaluator: harness.artifactEvaluator, userRequest: "normal doctor" })

    const result = await runWorkflowRuntimeDoctor({ harness, workflowId })

    expect(result.ok).toBe(true)
    expect(result.reason).toContain("no abnormal workflow state detected")
    expect(result.recommendation).toContain("workflow_attach")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("returns a graceful not-found diagnosis for missing workflows", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "workflow-runtime-doctor-missing-"))
    const harnessDir = join(repoDir, ".workflow-harness")
    const result = await runWorkflowRuntimeDoctorFromBaseDir({ baseDir: harnessDir, workflowId: "missing-workflow" })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("workflow not found")
    expect(result.recommendedTool).toBe("workflow_status")

    await rm(repoDir, { recursive: true, force: true })
  })

  it("does not create autopilot config files when reading from baseDir directly", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "workflow-runtime-doctor-readonly-"))
    const harnessDir = join(repoDir, ".workflow-harness")
    const harness = await createHarness(harnessDir)
    const workflowId = "wf-doctor-readonly"

    await initializeWorkflow({ workflowId, stateStore: harness.stateStore, artifactEvaluator: harness.artifactEvaluator, userRequest: "readonly doctor" })
    await rm(join(harnessDir, "autopilot.json"), { force: true })

    const result = await runWorkflowRuntimeDoctorFromBaseDir({ baseDir: harnessDir, workflowId })

    expect(result.ok).toBe(true)
    await expect(readFile(join(harnessDir, "autopilot.json"), "utf8")).rejects.toThrow()

    await rm(repoDir, { recursive: true, force: true })
  })

  it("does not modify spec_refinement artifacts during readonly diagnosis", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "workflow-runtime-doctor-readonly-spec-"))
    const harnessDir = join(repoDir, ".workflow-harness")
    const harness = await createHarness(harnessDir)
    const workflowId = "wf-doctor-readonly-spec"

    await initializeWorkflow({ workflowId, stateStore: harness.stateStore, artifactEvaluator: harness.artifactEvaluator, userRequest: "readonly spec doctor" })

    const specPath = harness.workspace.phaseArtifactFile(workflowId, "spec_refinement")
    const before = await readFile(specPath, "utf8")
    const result = await runWorkflowRuntimeDoctorFromBaseDir({ baseDir: harnessDir, workflowId })
    const after = await readFile(specPath, "utf8")

    expect(result.ok).toBe(true)
    expect(after).toBe(before)

    await rm(repoDir, { recursive: true, force: true })
  })

  it("falls back gracefully when events log is malformed", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "workflow-runtime-doctor-malformed-events-"))
    const harnessDir = join(repoDir, ".workflow-harness")
    const harness = await createHarness(harnessDir)
    const workflowId = "wf-doctor-malformed-events"

    await initializeWorkflow({ workflowId, stateStore: harness.stateStore, artifactEvaluator: harness.artifactEvaluator, userRequest: "malformed events doctor" })
    await rm(harness.workspace.eventsFile(workflowId), { force: true })
    await writeFile(harness.workspace.eventsFile(workflowId), "{not-json}\n", "utf8")

    const result = await runWorkflowRuntimeDoctorFromBaseDir({ baseDir: harnessDir, workflowId })

    expect(result.ok).toBe(true)
    expect(result.reason).toContain("no abnormal workflow state detected")

    await rm(repoDir, { recursive: true, force: true })
  })

  it("falls back gracefully when artifact state is malformed", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "workflow-runtime-doctor-malformed-artifact-"))
    const harnessDir = join(repoDir, ".workflow-harness")
    const harness = await createHarness(harnessDir)
    const workflowId = "wf-doctor-malformed-artifact"

    await initializeWorkflow({ workflowId, stateStore: harness.stateStore, artifactEvaluator: harness.artifactEvaluator, userRequest: "malformed artifact doctor" })
    await writeFile(harness.workspace.artifactStateFile(workflowId), "{not-json}\n", "utf8")

    const result = await runWorkflowRuntimeDoctorFromBaseDir({ baseDir: harnessDir, workflowId })

    expect(result.ok).toBe(true)
    expect(result.reason).toContain("no abnormal workflow state detected")

    await rm(repoDir, { recursive: true, force: true })
  })

  it("diagnoses stale in-progress workflows as stuck", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-runtime-doctor-stuck-"))
    const harness = await createHarness(baseDir)
    const workflowId = "wf-doctor-stuck"

    await initializeWorkflow({ workflowId, stateStore: harness.stateStore, artifactEvaluator: harness.artifactEvaluator, userRequest: "stuck doctor" })
    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const runtime = await harness.stateStore.getRuntime(workflowId)
    const staleAt = new Date(Date.now() - 20 * 60_000).toISOString()

    await harness.stateStore.saveWorkflow({
      ...workflow!,
      status: "in_progress",
      updatedAt: staleAt,
    })
    await harness.stateStore.saveRuntime({
      ...runtime!,
      lastContinuationAt: staleAt,
    })

    const result = await runWorkflowRuntimeDoctor({ harness, workflowId })

    expect(result.ok).toBe(false)
    expect(result.reason).toContain("stuck")
    expect(result.recommendation).toContain("workflow_attach")

    await rm(baseDir, { recursive: true, force: true })
  })
})
