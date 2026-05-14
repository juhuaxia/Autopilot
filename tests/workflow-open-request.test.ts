import { describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildWorkflowOpenRequest, buildWorkflowOpenRequestWithOptions, detectContinuationIntent } from "../packages/runtime/src/commands/workflow-open-request"

describe("detectContinuationIntent", () => {
  it("detects '继续下一步' as continuation intent", () => {
    const result = detectContinuationIntent("继续下一步")
    expect(result).not.toBeNull()
    expect(result?.matchedPattern).toBe("继续下一步")
    expect(result?.rawPayload).toBe("继续下一步")
  })

  it("detects '继续' as continuation intent", () => {
    const result = detectContinuationIntent("继续")
    expect(result).not.toBeNull()
    expect(result?.matchedPattern).toBe("继续")
  })

  it("detects '接着做' as continuation intent", () => {
    const result = detectContinuationIntent("接着做")
    expect(result).not.toBeNull()
    expect(result?.matchedPattern).toBe("接着做")
  })

  it("detects '往下走' as continuation intent", () => {
    const result = detectContinuationIntent("往下走")
    expect(result).not.toBeNull()
    expect(result?.matchedPattern).toBe("往下走")
  })

  it("detects '继续做' as continuation intent", () => {
    const result = detectContinuationIntent("继续做")
    expect(result).not.toBeNull()
    expect(result?.matchedPattern).toBe("继续做")
  })

  it("returns null for empty payload", () => {
    expect(detectContinuationIntent("")).toBeNull()
  })

  it("returns null for whitespace-only payload", () => {
    expect(detectContinuationIntent("   ")).toBeNull()
  })

  it("returns null for payloads over 100 chars", () => {
    const longPayload = "继续" + "x".repeat(100)
    expect(detectContinuationIntent(longPayload)).toBeNull()
  })

  it("returns null when payload contains action hints mixed with continuation", () => {
    expect(detectContinuationIntent("继续开发新功能")).toBeNull()
    expect(detectContinuationIntent("接着实现需求")).toBeNull()
    expect(detectContinuationIntent("往下推进流程")).toBeNull()
  })

  it("returns null for negated continuation payloads", () => {
    expect(detectContinuationIntent("不继续")).toBeNull()
    expect(detectContinuationIntent("不要继续下一步")).toBeNull()
    expect(detectContinuationIntent("别往下走")).toBeNull()
  })

  it("returns null for normal workflow-start payloads", () => {
    expect(detectContinuationIntent("启动 workflow")).toBeNull()
    expect(detectContinuationIntent("开始实现需求")).toBeNull()
    expect(detectContinuationIntent("分析一下代码结构")).toBeNull()
  })
})

describe("buildWorkflowOpenRequest populates continuationIntent", () => {
  it("sets continuationIntent for '继续下一步'", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "wf-open-continuation-"))
    try {
      const result = await buildWorkflowOpenRequest("继续下一步", workspaceRoot)
      expect(result.continuationIntent).not.toBeNull()
      expect(result.continuationIntent?.matchedPattern).toBe("继续下一步")
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it("does not set continuationIntent for normal action payloads", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "wf-open-normal-"))
    try {
      const result = await buildWorkflowOpenRequest("启动新的 workflow", workspaceRoot)
      expect(result.continuationIntent).toBeUndefined()
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it("does not set continuationIntent for mixed action+continuation payloads", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "wf-open-mixed-"))
    try {
      const result = await buildWorkflowOpenRequest("继续开发功能", workspaceRoot)
      expect(result.continuationIntent).toBeUndefined()
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it("does not set continuationIntent for negated continuation payloads", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "wf-open-negated-"))
    try {
      const result = await buildWorkflowOpenRequest("不要继续下一步", workspaceRoot)
      expect(result.continuationIntent).toBeUndefined()
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})

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

  it("extracts explicit @read targets from the prompt", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "workflow-open-read-targets-"))
    try {
      await mkdir(join(workspaceRoot, "docs"), { recursive: true })
      await writeFile(join(workspaceRoot, "docs", "acceptance.md"), "# Acceptance\n\nUse the screenshot values and checklist.")

      const result = await buildWorkflowOpenRequest(
        "购买页面的 video generate 标题下，增加 @read(local_docs/figma_md/17786586547155.png) 中的内容，并参考 @read(docs/acceptance.md)。",
        workspaceRoot,
      )

      expect(result.readTargets).toEqual([
        {
          raw: "@read(local_docs/figma_md/17786586547155.png)",
          path: "local_docs/figma_md/17786586547155.png",
          kind: "image",
        },
        {
          raw: "@read(docs/acceptance.md)",
          path: "docs/acceptance.md",
          kind: "text",
        },
      ])
      expect(result.userRequest).toContain("[READ_TARGETS]")
      expect(result.userRequest).toContain("type=image path=local_docs/figma_md/17786586547155.png")
      expect(result.userRequest).toContain("type=text path=docs/acceptance.md")
      expect(result.userRequest).toContain("[READ_TARGETS_POLICY]")
      expect(result.userRequest).toContain("[READ_TARGET_PATH] docs/acceptance.md")
      expect(result.userRequest).toContain("[READ_TARGET_CONTENT]")
      expect(result.userRequest).toContain("[READ_TARGET_IMAGE_PATH] local_docs/figma_md/17786586547155.png")
      expect(result.userRequest).toContain("[READ_TARGET_IMAGE_ERROR] image understanding unavailable in current environment")
      expect(result.userRequest).toContain("Use the screenshot values and checklist.")
      expect(result.textReadTargets).toEqual([
        {
          path: "docs/acceptance.md",
          content: "# Acceptance\n\nUse the screenshot values and checklist.",
        },
      ])
      expect(result.imageReadTargets).toEqual([
        {
          path: "local_docs/figma_md/17786586547155.png",
        },
      ])
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it("renders image summary when image summary service succeeds", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "workflow-open-image-summary-"))
    try {
      const result = await buildWorkflowOpenRequestWithOptions(
        "请参考 @read(local_docs/figma_md/17786586547155.png) 的内容。",
        workspaceRoot,
        {
          imageSummaryService: {
            summarize: async () => ({
              ok: true,
              summary: "- 图中包含 video generate 模块\n- 标题下有文案与列表信息",
            }),
          },
        },
      )

      expect(result.userRequest).toContain("[READ_TARGET_IMAGE_PATH] local_docs/figma_md/17786586547155.png")
      expect(result.userRequest).toContain("[READ_TARGET_IMAGE_SUMMARY]")
      expect(result.userRequest).toContain("video generate 模块")
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it("renders image error when image summary service is unavailable", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "workflow-open-image-error-"))
    try {
      const result = await buildWorkflowOpenRequestWithOptions(
        "请参考 @read(local_docs/figma_md/17786586547155.png) 的内容。",
        workspaceRoot,
        {
          imageSummaryService: {
            summarize: async () => ({
              ok: false,
              summary: "",
              error: "image understanding unavailable in current environment",
            }),
          },
        },
      )

      expect(result.userRequest).toContain("[READ_TARGET_IMAGE_PATH] local_docs/figma_md/17786586547155.png")
      expect(result.userRequest).toContain("[READ_TARGET_IMAGE_ERROR] image understanding unavailable in current environment")
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it("limits image read targets to the first five entries", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "workflow-open-image-limit-"))
    try {
      const payload = Array.from({ length: 6 }, (_, index) => `@read(local_docs/figma_md/${index}.png)`).join(" ")
      const calls: string[] = []
      const result = await buildWorkflowOpenRequestWithOptions(payload, workspaceRoot, {
        imageSummaryService: {
          summarize: async (imagePath) => {
            calls.push(imagePath)
            return {
              ok: false,
              summary: "",
              error: "image understanding unavailable in current environment",
            }
          },
        },
      })

      expect(calls.length).toBe(5)
      expect(result.userRequest).toContain("[READ_TARGET_WARNING] only the first 5 image read targets were analyzed")
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})
