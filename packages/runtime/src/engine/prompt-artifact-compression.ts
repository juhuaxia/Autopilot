import type { Phase } from "../../../core/src/state/phase"

export const MAX_SOURCE_ARTIFACT_CHARS = 6000
export const MAX_CURRENT_ARTIFACT_CHARS = 8000

const INVALID_PROMPT_SECTION_MARKERS = ["待确认", "待补充", "待判定", "待 AI", "待AI", "TODO", "TBD", "unknown", "自行补充", "按文档内容", "按照文档内容", "参考文档"]

const ARTIFACT_SECTION_RULES: Record<Extract<Phase, "spec_refinement" | "plan" | "develop" | "review" | "test">, {
  title: string
  sections: string[]
}> = {
  spec_refinement: {
    title: "# 规格精炼报告",
    sections: [
      "## 原始需求摘要",
      "## 需求澄清",
      "## 技术约束",
      "## 验收标准",
      "## 疑问清单",
      "## 准入结论",
      "## 报告语言",
    ],
  },
  plan: {
    title: "# 开发计划",
    sections: [
      "## 需求摘要",
      "## 影响范围",
      "## 核心修改文件",
      "## Cascade Files",
      "## 实现方案",
      "## i18n 变更",
      "## API / Route 变更",
      "## 组件复用决策",
      "## Section 验收映射（多 section Figma 页面必填）",
      "## Key Visual Elements（复杂 Figma 页面必填）",
      "## 疑问清单",
      "## 风险评估",
      "## 报告语言",
    ],
  },
  develop: {
    title: "# 开发报告",
    sections: [
      "## 状态",
      "## 修改文件",
      "## 配套修改",
      "## 自检结果",
      "## 备注",
      "## 报告语言",
    ],
  },
  review: {
    title: "# 审查报告",
    sections: [
      "## 状态",
      "## 轮次",
      "## 检查范围",
      "## 组件复用验收结果（如适用）",
      "## Section 验收映射检查结果（如适用）",
      "## 发现的问题",
      "## 问题严重度汇总",
      "## 历史遗留观察项（非阻塞，可选）",
      "## Regression 风险评估",
      "## 结论",
      "## 报告语言",
    ],
  },
  test: {
    title: "# 测试报告",
    sections: [
      "## 状态",
      "## 轮次",
      "## 测试策略",
      "## 验证范围",
      "## 测试概要",
      "## 新增页面专项验证（如适用）",
      "## Figma 高保真验证（如适用）",
      "## Key Visual Elements 验证（如适用）",
      "## 失败项",
      "## 历史遗留观察项（非阻塞，可选）",
      "## Regression 验证",
      "## 覆盖范围",
      "## 开发者决策建议",
      "## 结论",
      "## 报告语言",
    ],
  },
}

const PROMPT_SECTION_PRIORITY: Partial<Record<Extract<Phase, "spec_refinement" | "plan" | "develop" | "review" | "test">, string[]>> = {
  spec_refinement: ["## 原始需求摘要", "## 技术约束", "## 验收标准", "## 疑问清单", "## 准入结论"],
  plan: ["## 需求摘要", "## 影响范围", "## 核心修改文件", "## 实现方案", "## 风险评估", "## 疑问清单"],
  develop: ["## 状态", "## 修改文件", "## 配套修改", "## 自检结果", "## 备注"],
  review: ["## 状态", "## 检查范围", "## 发现的问题", "## 问题严重度汇总", "## Regression 风险评估", "## 结论"],
  test: ["## 状态", "## 测试策略", "## 验证范围", "## 失败项", "## Regression 验证", "## 覆盖范围", "## 结论"],
}

function findHeadingIndex(content: string, heading: string, startIndex = 0): number {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`^${escaped}(?:$|\\s)`, "m")
  const sliced = startIndex > 0 ? content.slice(startIndex) : content
  const match = regex.exec(sliced)
  return match ? match.index + startIndex : -1
}

function stripComments(content: string): string {
  return content.replace(/<!--([\s\S]*?)-->/g, "").trim()
}

function extractSectionBody(content: string, heading: string, allHeadings: string[]): string {
  const start = findHeadingIndex(content, heading)
  if (start === -1) {
    return ""
  }

  const afterHeading = start + heading.length
  const nextHeadingIndexes = allHeadings
    .map((nextHeading) => findHeadingIndex(content, nextHeading, afterHeading))
    .filter((index) => index !== -1)
  const end = nextHeadingIndexes.length > 0 ? Math.min(...nextHeadingIndexes) : content.length

  return stripComments(content.slice(afterHeading, end))
}

function trimBodyAtUnknownHeading(body: string): string {
  const unknownHeadingMatch = /\n(?=#{1,6}\s)/.exec(body)
  if (!unknownHeadingMatch || unknownHeadingMatch.index < 0) {
    return body
  }
  return body.slice(0, unknownHeadingMatch.index).trimEnd()
}

function isMeaningfulPromptSectionBody(body: string): boolean {
  const trimmed = body.trim()
  if (!trimmed) {
    return false
  }

  const normalized = trimmed.toLowerCase()
  return !INVALID_PROMPT_SECTION_MARKERS.some((marker) => normalized === marker.toLowerCase())
}

function trimPromptArtifactContent(content: string, maxChars: number, note = "Artifact content trimmed for prompt focus."): string {
  if (content.length <= maxChars) {
    return content
  }

  const trimmed = content.slice(0, maxChars).trimEnd()
  return `${trimmed}\n\n[TRUNCATED] ${note}`
}

export function compressArtifactForPrompt(
  content: string,
  phase: Extract<Phase, "spec_refinement" | "plan" | "develop" | "review" | "test">,
  maxChars: number,
): string {
  const rule = ARTIFACT_SECTION_RULES[phase]
  const preferredSections = PROMPT_SECTION_PRIORITY[phase] ?? rule.sections
  const allHeadings = rule.sections

  const buildCompressedContent = (headings: string[]): string | null => {
    const selectedBlocks: string[] = [rule.title, ""]
    let usedStructuredCompression = false

    for (const heading of headings) {
      const body = trimBodyAtUnknownHeading(extractSectionBody(content, heading, allHeadings)).trim()
      if (!isMeaningfulPromptSectionBody(body)) {
        continue
      }
      usedStructuredCompression = true
      selectedBlocks.push(heading, body, "")
    }

    return usedStructuredCompression ? selectedBlocks.join("\n").trim() : null
  }

  const summarized = buildCompressedContent(preferredSections) ?? buildCompressedContent(rule.sections)

  if (summarized) {
    if (summarized.length <= maxChars) {
      return `${summarized}\n\n[COMPRESSED] Artifact compressed by key sections for prompt focus.`
    }
    return trimPromptArtifactContent(summarized, maxChars, "Artifact compressed by key sections for prompt focus.")
  }

  return trimPromptArtifactContent(content, maxChars, "Artifact content trimmed for prompt focus.")
}
