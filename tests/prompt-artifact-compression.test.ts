import { describe, expect, it } from "bun:test"
import { compressArtifactForPrompt } from "../packages/runtime/src/engine/prompt-artifact-compression"

describe("prompt artifact compression", () => {
  it("keeps key plan sections and drops irrelevant long tail", () => {
    const content = [
      "# 开发计划",
      "",
      "## 需求摘要",
      "新增 AI 短剧入口。",
      "",
      "## 实现方案",
      "先做页面，再接服务。",
      "",
      "## 风险评估",
      "上传超时风险。",
      "",
      "## 附加长文本",
      "A".repeat(9000),
    ].join("\n")

    const result = compressArtifactForPrompt(content, "plan", 6000)
    expect(result).toContain("[COMPRESSED]")
    expect(result).toContain("## 需求摘要")
    expect(result).toContain("## 实现方案")
    expect(result).not.toContain("## 附加长文本")
  })

  it("falls back to truncation when no known headings exist", () => {
    const result = compressArtifactForPrompt(`无标准标题\n\n${"B".repeat(9000)}`, "plan", 6000)
    expect(result).toContain("[TRUNCATED] Artifact content trimmed for prompt focus.")
    expect(result).toContain("无标准标题")
  })

  it("filters placeholder-only sections", () => {
    const content = [
      "# 开发计划",
      "",
      "## 需求摘要",
      "待补充",
      "",
      "## 影响范围",
      "TODO",
      "",
      "## 实现方案",
      "新增上传与结果展示。",
    ].join("\n")

    const result = compressArtifactForPrompt(content, "plan", 6000)
    expect(result).toContain("## 实现方案")
    expect(result).not.toContain("## 需求摘要\n待补充")
    expect(result).not.toContain("## 影响范围\nTODO")
  })

  it("falls back to standard sections when preferred sections are invalid", () => {
    const content = [
      "# 开发计划",
      "",
      "## 需求摘要",
      "待补充",
      "",
      "## 实现方案",
      "按文档内容",
      "",
      "## API / Route 变更",
      "新增 /api/drama/prompt 路由。",
      "",
      "## 组件复用决策",
      "复用现有上传组件样式。",
    ].join("\n")

    const result = compressArtifactForPrompt(content, "plan", 6000)
    expect(result).toContain("## API / Route 变更")
    expect(result).toContain("## 组件复用决策")
    expect(result).not.toContain("## 需求摘要\n待补充")
  })

  it("skips empty sections while preserving meaningful ones", () => {
    const content = [
      "# 开发报告",
      "",
      "## 状态",
      "",
      "## 修改文件",
      "src/pages/Drama.vue",
      "",
      "## 自检结果",
      "typecheck 通过。",
    ].join("\n")

    const result = compressArtifactForPrompt(content, "develop", 8000)
    expect(result).toContain("## 修改文件")
    expect(result).toContain("## 自检结果")
    expect(result).not.toContain("## 状态\n\n##")
  })
})
