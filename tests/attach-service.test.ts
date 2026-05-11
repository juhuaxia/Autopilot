import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHarness } from "../packages/runtime/src/bootstrap/create-harness"
import { initializeWorkflow } from "../packages/runtime/src/bootstrap/initialize-workflow"

describe("attach service", () => {
  it("re-attaches and records attach event", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-attach-"))
    const harness = await createHarness(baseDir)
    const workflowId = "wf-attach"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
    })

    await harness.attachService.attach(workflowId)

    const events = await harness.eventStore.list(workflowId)
    expect(events.some((event) => event.type === "workflow.attached")).toBe(true)

    await rm(baseDir, { recursive: true, force: true })
  })
})
