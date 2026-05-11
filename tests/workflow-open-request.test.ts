import { describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildWorkflowOpenRequest } from "../packages/runtime/src/commands/workflow-open-request"

describe("workflow open request", () => {
  it("adds recall-only doc candidates from common dirs for natural language payload", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "workflow-open-request-"))
    const docsDir = join(workspaceRoot, "docs")
    const specsDir = join(workspaceRoot, "specs")
    await mkdir(docsDir, { recursive: true })
    await mkdir(specsDir, { recursive: true })
    await writeFile(join(docsDir, "requirements.md"), "# Requirements")
    await writeFile(join(specsDir, "api.md"), "# API")

    try {
      const result = await buildWorkflowOpenRequest("需求文档在 docs 目录，请推进", workspaceRoot)

      expect(result.userRequest).toContain("[DOC_CANDIDATES]")
      expect(result.userRequest).toContain("docs/requirements.md")
      expect(result.userRequest).toContain("specs/api.md")
      expect(result.userRequest).toContain("[DOC_CANDIDATES_POLICY]")
      expect(result.userRequest).not.toContain("[DOC_CONTENT]")
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})
