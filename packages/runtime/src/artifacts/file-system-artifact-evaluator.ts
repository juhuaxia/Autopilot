import { readFile, writeFile } from "node:fs/promises"
import type { ArtifactEvaluation, ArtifactEvaluator } from "../../../core/src/artifacts/artifact-evaluator"
import type { Phase } from "../../../core/src/state/phase"
import type { WorkflowRuntimeState } from "../../../core/src/state/workflow-runtime-state"
import type { WorkflowState } from "../../../core/src/state/workflow-state"
import type { Question } from "../../../core/src/human-actions/question"
import { getAutopilotPresetDefinition } from "../commands/autopilot-presets"
import { readJsonFile, writeJsonFile } from "../shared/json-file"
import { buildWorkspaceCodeSnapshot, resolveCodeScanRoot } from "../shared/workspace-code-fingerprint"
import type { WorkflowWorkspace } from "../workspace/workflow-workspace"

function normalizeListFilePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/")
}

function countRealCodeChanges(currentSnapshot: Record<string, string>, baselineSnapshot: Record<string, string> | null, listedFiles: string[]): number {
  if (!baselineSnapshot) {
    return 0
  }

  return listedFiles
    .map(normalizeListFilePath)
    .filter((filePath) => !isArtifactOnlyListedFile(filePath))
    .filter((filePath) => {
      const currentEntry = currentSnapshot[filePath]
      const baselineEntry = baselineSnapshot[filePath]
      if (typeof baselineEntry === "string" && typeof currentEntry === "string") {
        return baselineEntry !== currentEntry
      }
      return typeof baselineEntry === "string" && typeof currentEntry !== "string"
        ? true
        : typeof baselineEntry !== "string" && typeof currentEntry === "string"
          ? true
          : false
    }).length
}

interface PhaseArtifactState {
  valid: boolean
  readyForNextPhase: boolean
  missing?: string[]
  warnings?: string[]
  summary?: string
  questions?: Question[]
  initialRequest?: string
  requiresApproval?: boolean
  reportStatus?: "pass" | "fail" | "unknown"
  hasBlockingSeverity?: boolean
  templateFingerprint?: string
}

type ArtifactStateFile = Partial<Record<Phase, PhaseArtifactState>>

const DEFAULT_USER_REQUEST = "新增 workflow harness MVP。"

type SpecRefinementQuestionBlueprint = {
  id: string
  heading: string
  priority: Question["priority"]
  text: string
  canAutoResolve: boolean
  suggestedAnswer: (args: { initialRequest: string }) => string
}

const SPEC_REFINEMENT_QUESTION_BLUEPRINTS: SpecRefinementQuestionBlueprint[] = [
  {
    id: "q_original_summary",
    heading: "## 原始需求摘要",
    priority: "required",
    text: "请补充本次需求的原始需求摘要。",
    canAutoResolve: true,
    suggestedAnswer: ({ initialRequest }) => initialRequest,
  },
  {
    id: "q_requirements_clarification",
    heading: "## 需求澄清",
    priority: "required",
    text: "请补充本次需求的需求澄清，明确范围边界、关键行为或例外场景。",
    canAutoResolve: false,
    suggestedAnswer: () => "请补充范围边界、关键行为、例外场景或默认策略。",
  },
  {
    id: "q_technical_constraints",
    heading: "## 技术约束",
    priority: "required",
    text: "请补充本次需求的技术约束。",
    canAutoResolve: true,
    suggestedAnswer: () => "遵循现有仓库技术栈、代码风格、宿主可插拔约束与现有 workflow runtime 模式。",
  },
  {
    id: "q_acceptance_criteria",
    heading: "## 验收标准",
    priority: "required",
    text: "请确认本次需求的具体验收标准或完成定义。",
    canAutoResolve: false,
    suggestedAnswer: () => "请补充可验证的验收标准，例如页面行为、交互结果或完成定义。",
  },
  {
    id: "q_open_questions",
    heading: "## 疑问清单",
    priority: "recommended",
    text: "请补充当前仍待确认的疑问；若无疑问请填写“无”。",
    canAutoResolve: true,
    suggestedAnswer: () => "无",
  },
  {
    id: "q_report_language",
    heading: "## 报告语言",
    priority: "optional",
    text: "请确认 refinement 报告语言。",
    canAutoResolve: true,
    suggestedAnswer: () => "中文",
  },
]

const unresolvedMarkers = ["待确认", "待补充", "待判定", "待 ai", "tbd", "todo", "unknown", "自行补充", "按文档内容", "按照文档内容", "参考文档"]

const buildTemplateFingerprint = (content: string): string => JSON.stringify(
  content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0),
)

const SECTION_RULES: Record<Extract<Phase, "spec_refinement" | "plan" | "develop" | "review" | "test">, {
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
      "## 建议修复文件（如适用）",
      "## 建议修复方案（如适用）",
      "## 建议验证命令（如适用）",
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

const NON_BLOCKING_SECTIONS: Partial<Record<Extract<Phase, "develop" | "review" | "test">, string[]>> = {
  develop: ["## 配套修改", "## 备注", "## 报告语言"],
  review: ["## 组件复用验收结果（如适用）", "## Section 验收映射检查结果（如适用）", "## 建议修复文件（如适用）", "## 建议修复方案（如适用）", "## 建议验证命令（如适用）", "## 历史遗留观察项（非阻塞，可选）", "## 报告语言"],
  test: ["## 新增页面专项验证（如适用）", "## Figma 高保真验证（如适用）", "## Key Visual Elements 验证（如适用）", "## 历史遗留观察项（非阻塞，可选）", "## 开发者决策建议", "## 报告语言"],
}

const stripComments = (content: string): string =>
  content.replace(/<!--([\s\S]*?)-->/g, "").trim()

/**
 * Find the index of a markdown heading in content, matching ONLY at line start
 * with exact heading level. Prevents false matches like "### 结论：..." hitting "## 结论".
 */
const findHeadingIndex = (content: string, heading: string, startIndex = 0): number => {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`^${escaped}(?:$|\\s)`, "m")
  const sliced = startIndex > 0 ? content.slice(startIndex) : content
  const match = regex.exec(sliced)
  return match ? match.index + startIndex : -1
}

const extractSectionBody = (content: string, heading: string, allHeadings: string[]): string => {
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

const sectionHasContent = (content: string, heading: string, allHeadings: string[]): boolean =>
  extractSectionBody(content, heading, allHeadings).length > 0

const findOutOfOrderHeadings = (content: string, headings: string[]): string[] => {
  const present = headings
    .map((heading) => ({ heading, index: findHeadingIndex(content, heading) }))
    .filter((entry) => entry.index !== -1)

  const outOfOrder: string[] = []
  let lastIndex = -1
  for (const entry of present) {
    if (entry.index < lastIndex) {
      const expectedPreviousHeading = headings[headings.indexOf(entry.heading) - 1]
      outOfOrder.push(expectedPreviousHeading
        ? `section_order_invalid: ${entry.heading} should appear after ${expectedPreviousHeading}`
        : `section_order_invalid: ${entry.heading}`)
      continue
    }
    lastIndex = entry.index
  }
  return outOfOrder
}

const isOptionalSection = (heading: string): boolean =>
  heading.includes("（如适用）") || heading.includes("（非阻塞，可选）")

const sanitizeSummaryBody = (body: string): string => body
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .filter((line) => line !== "[USER_PROMPT]")
  .filter((line) => !/^(?:文档[:：]?)?(?:\.?\.?\/|\/).+\.(?:md|markdown|txt|rst|adoc|pdf|docx)$/i.test(line))
  .join("\n")

const ARTIFACT_ONLY_PATH_PATTERNS = [
  /(^|\/)spec_refinement\.md$/i,
  /(^|\/)plan\.md$/i,
  /(^|\/)develop\.md$/i,
  /(^|\/)review\.md$/i,
  /(^|\/)test\.md$/i,
  /(^|\/)artifact-state\.json$/i,
  /(^|\/)workflow-state\.json$/i,
  /(^|\/)workflow-runtime-state\.json$/i,
  /(^|\/)human-action\.json$/i,
  /(^|\/)sessions\.json$/i,
  /(^|\/)events(?:\.ndjson|\.json)$/i,
  /(^|\/)review-sidecar\.json$/i,
]

const extractListedFilesFromDevelopArtifact = (content: string): string[] => {
  const body = extractSectionBody(content, "## 修改文件", SECTION_RULES.develop.sections)
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^\d+\.\s*/, ""))
    .map((line) => line.replace(/^[-*]\s*/, ""))
    .map((line) => line.match(/`([^`]+)`/)?.[1] ?? line)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const isArtifactOnlyListedFile = (filePath: string): boolean => {
  const normalized = filePath.trim().replace(/\\/g, "/")
  return ARTIFACT_ONLY_PATH_PATTERNS.some((pattern) => pattern.test(normalized))
}

const questionChecklistResolved = (content: string, sections: string[]): boolean => {
  const body = extractSectionBody(content, "## 疑问清单", sections)
  const normalized = body.trim()
  if (!normalized) {
    return false
  }
  if (["无", "none", "n/a", "na", "no questions", "not applicable"].includes(normalized.toLowerCase())) {
    return true
  }

  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .every((line) => {
      const lower = line.toLowerCase()
      return (
        lower.includes("resolved")
        || lower.includes("answered")
        || lower.includes("confirmed")
        || lower.includes("all answered")
        || lower.includes("已解决")
        || lower.includes("已确认")
        || lower.includes("全部解决")
        || line.startsWith("✅")
        || line.startsWith("- ✅")
        || line.startsWith("- [x]")
        || line.startsWith("[x]")
      )
    })
}

const hasReadyForPlanConclusion = (content: string, sections: string[]): boolean => {
  const body = extractSectionBody(content, "## 准入结论", sections)
  return body
    .split("\n")
    .map((line) => line.replace(/[*`>#-]/g, "").trim())
    .some((line) => line === "READY_FOR_PLAN" || line.includes("READY_FOR_PLAN"))
}

const containsUnresolvedMarker = (body: string): boolean => {
  const normalized = body.trim().toLowerCase()
  return unresolvedMarkers.some((marker) => normalized.includes(marker))
}

const hasCompletedStatus = (content: string, sections: string[]): boolean => {
  const body = extractSectionBody(content, "## 状态", sections).toLowerCase()
  return ["通过", "pass", "passed", "completed", "完成", "done"].some((token) => body.includes(token))
}

const firstMeaningfulLine = (body: string): string => body
  .split("\n")
  .map((line) => line.trim())
  .find(Boolean) ?? ""

const getReportStatus = (content: string): "pass" | "fail" | "unknown" => {
  const rawConclusion = extractSectionBody(content, "## 结论", ["## 结论", "## Conclusion"])
  const conclusion = firstMeaningfulLine(rawConclusion).toLowerCase()
  if (rawConclusion.trim()) {
    if (["未通过", "失败", "fail", "failed", "blocked"].some((token) => conclusion.includes(token))) {
      return "fail"
    }
    if (["通过", "pass", "passed"].some((token) => conclusion.includes(token))) {
      return "pass"
    }
    return "unknown"
  }

  const firstLine = firstMeaningfulLine(extractSectionBody(content, "## 状态", ["## 状态", "## Status"]).toLowerCase())
  if (!firstLine) {
    return "unknown"
  }

  if (firstLine.includes("待判定") || firstLine.includes("待执行") || firstLine.includes("pending") || firstLine.includes("unknown")) {
    return "unknown"
  }
  if (["未通过", "失败", "fail", "failed", "blocked"].some((token) => firstLine.includes(token))) {
    return "fail"
  }
  if (["通过", "pass", "passed", "completed", "完成", "done"].some((token) => firstLine.includes(token))) {
    return "pass"
  }
  return "unknown"
}

const hasBlockingSeverity = (content: string): boolean =>
  content.split("\n").some((line) => {
    const normalized = line.trim().toLowerCase()
    if (/^#{0,6}\s*\[(?:severity:\s*)?(blocker|critical)\](?:\s|$)/i.test(normalized)) {
      return true
    }
    const summaryMatch = normalized.match(/^(?:[-*]\s*)?(blocker|critical)\s*[:：]\s*(\d+)/i)
    return summaryMatch ? Number(summaryMatch[2]) > 0 : false
  })

const hasSufficientTestEvidence = (content: string, sections: string[]): boolean => {
  const criticalSections = [
    "## 测试概要",
    "## Regression 验证",
    "## 覆盖范围",
    "## 开发者决策建议",
    "## 结论",
  ]

  for (const section of criticalSections) {
    const body = extractSectionBody(content, section, sections)
    if (!body || containsUnresolvedMarker(body)) {
      return false
    }
    const normalized = body.toLowerCase()
    if (
      normalized.includes("人工走查")
      || normalized.includes("手动打开")
      || normalized.includes("未自动执行")
      || normalized.includes("建议在浏览器中做一次")
    ) {
      return false
    }
  }

  return true
}

export class FileSystemArtifactEvaluator implements ArtifactEvaluator {
  constructor(private readonly workspace: WorkflowWorkspace) {}

  private normalizeUserRequest(userRequest?: string): string {
    const normalized = userRequest?.trim()
    return normalized && normalized.length > 0 ? normalized : DEFAULT_USER_REQUEST
  }

  private buildRefinementClarification(userRequest: string): string {
    return `当前主体需求：${userRequest}\n\n需要在进入 plan 前进一步确认范围边界、例外场景与交付口径。`
  }

  private buildRefinementConstraints(): string {
    return "遵循现有仓库技术栈、代码风格、宿主可插拔约束与现有 workflow runtime 模式。"
  }

  private buildQuestionChecklist(questions: Question[], answers: Record<string, string> = {}): string {
    if (questions.length === 0) {
      return "无"
    }

    return questions.map((question) => {
      const answer = answers[question.id]?.trim()
      if (answer && !containsUnresolvedMarker(answer)) {
        return `- [x] ${question.text} 已确认：${answer}`
      }
      return `- [ ] ${question.text}`
    }).join("\n")
  }

  private defaultSpecSectionBodies(userRequest?: string): Record<string, string> {
    const initialRequest = this.normalizeUserRequest(userRequest)
    return {
      "## 原始需求摘要": initialRequest,
      "## 需求澄清": this.buildRefinementClarification(initialRequest),
      "## 技术约束": this.buildRefinementConstraints(),
      "## 验收标准": "待确认：请补充本次需求的可验证验收标准或完成定义。",
      "## 疑问清单": "无",
      "## 准入结论": "NOT_READY_FOR_PLAN",
      "## 报告语言": "中文",
    }
  }

  private readSpecSectionBodies(content: string, userRequest?: string): Record<string, string> {
    const defaults = this.defaultSpecSectionBodies(userRequest)
    return Object.fromEntries(
      SECTION_RULES.spec_refinement.sections.map((heading) => {
        const body = extractSectionBody(content, heading, SECTION_RULES.spec_refinement.sections)
        return [heading, body || defaults[heading] || ""]
      }),
    )
  }

  private buildSpecRefinementQuestionsFromSections(args: {
    sectionBodies: Record<string, string>
    initialRequest: string
  }): Question[] {
    const { sectionBodies, initialRequest } = args
    return SPEC_REFINEMENT_QUESTION_BLUEPRINTS
      .filter((blueprint) => {
        const body = sectionBodies[blueprint.heading]?.trim() ?? ""
        return !body || containsUnresolvedMarker(body)
      })
      .map((blueprint) => ({
        id: blueprint.id,
        priority: blueprint.priority,
        text: blueprint.text,
        canAutoResolve: blueprint.canAutoResolve,
        suggestedAnswer: blueprint.suggestedAnswer({ initialRequest }),
      }))
  }

  private finalizeSpecSectionBodies(args: {
    sectionBodies: Record<string, string>
    initialRequest: string
    answers?: Record<string, string>
  }): Record<string, string> {
    const { sectionBodies, initialRequest, answers = {} } = args
    const questions = this.buildSpecRefinementQuestionsFromSections({
      sectionBodies,
      initialRequest,
    })
    const unresolvedQuestions = questions.filter((question) => {
      const answer = answers[question.id]?.trim()
      return !answer || containsUnresolvedMarker(answer)
    })

    return {
      ...sectionBodies,
      "## 疑问清单": this.buildQuestionChecklist(unresolvedQuestions, answers),
      "## 准入结论": unresolvedQuestions.length === 0 ? "READY_FOR_PLAN" : "NOT_READY_FOR_PLAN",
      "## 报告语言": sectionBodies["## 报告语言"]?.trim() || "中文",
    }
  }

  private buildRefinementArtifactFromSections(sectionBodies: Record<string, string>): string {
    return [
      "# 规格精炼报告",
      "",
      ...SECTION_RULES.spec_refinement.sections.flatMap((heading) => [heading, sectionBodies[heading] ?? "", ""]),
    ].slice(0, -1).join("\n")
  }

  private autoFillSpecRefinementContent(content: string, initialRequest: string): string {
    const sectionBodies = this.readSpecSectionBodies(content, initialRequest)

    for (const blueprint of SPEC_REFINEMENT_QUESTION_BLUEPRINTS) {
      if (!blueprint.canAutoResolve) {
        continue
      }

      const currentBody = sectionBodies[blueprint.heading]?.trim() ?? ""
      if (currentBody && !containsUnresolvedMarker(currentBody)) {
        continue
      }

      sectionBodies[blueprint.heading] = blueprint.suggestedAnswer({ initialRequest })
    }

    const finalBodies = this.finalizeSpecSectionBodies({
      sectionBodies,
      initialRequest,
    })

    return this.buildRefinementArtifactFromSections(finalBodies)
  }

  private buildRefinementArtifact(args: {
    userRequest?: string
    acceptanceAnswer?: string
  }): string {
    const userRequest = this.normalizeUserRequest(args.userRequest)
    const acceptanceAnswer = args.acceptanceAnswer?.trim()
    const sectionBodies = this.defaultSpecSectionBodies(userRequest)
    if (acceptanceAnswer) {
      sectionBodies["## 验收标准"] = acceptanceAnswer
    }
    const finalBodies = this.finalizeSpecSectionBodies({
      sectionBodies,
      initialRequest: userRequest,
      ...(acceptanceAnswer ? { answers: { q_acceptance_criteria: acceptanceAnswer } } : {}),
    })

    return this.buildRefinementArtifactFromSections(finalBodies)
  }

  private buildPlanArtifactFromRefinementContent(refinementContent: string): string {
    const summary = sanitizeSummaryBody(extractSectionBody(refinementContent, "## 原始需求摘要", SECTION_RULES.spec_refinement.sections).trim())
      || this.normalizeUserRequest(undefined)
    const constraints = extractSectionBody(refinementContent, "## 技术约束", SECTION_RULES.spec_refinement.sections).trim()
      || "待结合仓库现状补充技术约束。"
    const acceptance = extractSectionBody(refinementContent, "## 验收标准", SECTION_RULES.spec_refinement.sections).trim()
      || "待补充可验证验收标准。"
    const questions = extractSectionBody(refinementContent, "## 疑问清单", SECTION_RULES.spec_refinement.sections).trim()
      || "无"

    return [
      "# 开发计划",
      "",
      "## 需求摘要",
      summary,
      "",
      "## 影响范围",
      "待 AI 结合仓库结构与需求范围补充。",
      "",
      "## 核心修改文件",
      "待 AI 结合代码探索结果补充。",
      "",
      "## Cascade Files",
      "待 AI 结合依赖链补充。",
      "",
      "## 实现方案",
      "待 AI 输出分步骤实现方案，并明确为什么这样做。",
      "",
      "## i18n 变更",
      "待 AI 判定是否涉及。",
      "",
      "## API / Route 变更",
      "待 AI 判定是否涉及。",
      "",
      "## 组件复用决策",
      "待 AI 说明复用/不复用理由。",
      "",
      "## Section 验收映射（多 section Figma 页面必填）",
      "不适用或待 AI 结合设计上下文补充。",
      "",
      "## Key Visual Elements（复杂 Figma 页面必填）",
      "不适用或待 AI 结合设计上下文补充。",
      "",
      "## 疑问清单",
      questions,
      "",
      "## 风险评估",
      `技术约束：${constraints}\n\n验收标准：${acceptance}\n\n待 AI 进一步识别风险、受影响旧功能与回归验证建议。`,
      "",
      "## 报告语言",
      "中文",
    ].join("\n")
  }

  private buildDevelopArtifactFromPlanContent(planContent: string): string {
    const summary = extractSectionBody(planContent, "## 需求摘要", SECTION_RULES.plan.sections).trim()
      || "待结合计划补充需求摘要。"
    const coreFiles = extractSectionBody(planContent, "## 核心修改文件", SECTION_RULES.plan.sections).trim()
      || "待根据开发计划补充。"
    const implementation = extractSectionBody(planContent, "## 实现方案", SECTION_RULES.plan.sections).trim()
      || "待根据开发计划补充。"
    const risk = extractSectionBody(planContent, "## 风险评估", SECTION_RULES.plan.sections).trim()
      || "待根据开发计划补充。"

    return [
      "# 开发报告",
      "",
      "## 状态",
      "进行中",
      "",
      "## 修改文件",
      coreFiles,
      "",
      "## 配套修改",
      `需求摘要：${summary}\n\n实现方案：${implementation}`,
      "",
      "## 自检结果",
      "待 AI 在完成实现后补充测试、构建、自检证据，以及受影响旧功能的回归检查结果。",
      "",
      "## 备注",
      `风险提示：${risk}`,
      "",
      "## 报告语言",
      "中文",
    ].join("\n")
  }

  private buildReviewArtifactFromDevelopContent(developContent: string, presetMode?: WorkflowRuntimeState["presetMode"]): string {
    const modifiedFiles = extractSectionBody(developContent, "## 修改文件", SECTION_RULES.develop.sections).trim()
      || "待根据开发结果补充。"
    const pairedChanges = extractSectionBody(developContent, "## 配套修改", SECTION_RULES.develop.sections).trim()
      || "待根据开发结果补充。"
    const selfCheck = extractSectionBody(developContent, "## 自检结果", SECTION_RULES.develop.sections).trim()
      || "待根据开发结果补充。"
    const notes = extractSectionBody(developContent, "## 备注", SECTION_RULES.develop.sections).trim()
      || "无"
    const reviewerSections = presetMode
      ? (getAutopilotPresetDefinition(presetMode).runtimePolicy.reviewRoles ?? []).map((role) => [
          `## Reviewer: ${role.name}`,
          `待 AI 根据以下重点补充：${role.focus}`,
        ] as const)
      : [
          ["## Reviewer: Business", "待 AI 根据业务正确性补充。"],
          ["## Reviewer: Edge", "待 AI 根据边界与异常补充。"],
          ["## Reviewer: Quality", "待 AI 根据工程质量补充。"],
        ]

    return [
      "# 审查报告",
      "",
      "## 状态",
      "待判定",
      "",
      "## 轮次",
      "第 1 轮",
      "",
      "## 检查范围",
      "待 AI 根据开发输出与计划补充。",
      "",
      "## 组件复用验收结果（如适用）",
      "不适用或待 AI 判定。",
      "",
      "## Section 验收映射检查结果（如适用）",
      "不适用或待 AI 判定。",
      "",
      "## 建议修复文件（如适用）",
      "待 AI 根据发现的问题列出最小受影响文件集合。",
      "",
      "## 建议修复方案（如适用）",
      "待 AI 根据发现的问题补充最小修复路径。",
      "",
      "## 建议验证命令（如适用）",
      "待 AI 补充至少一条与修复直接相关的验证命令。",
      "",
      ...reviewerSections.flatMap(([heading, body]) => [heading, body, ""]),
      "## 发现的问题",
      "待 AI 审查开发产物后补充。若存在 Reviewer Summaries 或 Candidate Findings For Main Review，请先合并 reviewer sidecar 候选问题后去重整理，再写入主问题清单。",
      "",
      "## 问题严重度汇总",
      "blocker: 0\n\n若 reviewer sidecar 已存在，请按 merge policy 汇总最高优先级/最保守结论。Reviewer Severity Summary 仅作为辅助，不直接覆盖主严重度判断。",
      "",
      "## 历史遗留观察项（非阻塞，可选）",
      notes,
      "",
      "## Regression 风险评估",
      `修改文件：${modifiedFiles}\n\n配套修改：${pairedChanges}\n\n自检结果：${selfCheck}\n\n请重点关注是否影响既有功能并补充回归风险判断。`,
      "",
      "## 结论",
      "待判定\n\n若 reviewer sidecar 已存在，请结合 Reviewer Summaries、Candidate Findings For Main Review 与 Reviewer Conclusion Hint 输出统一结论；如主结论已由人工或主流程明确填写，则不要被 sidecar 提示覆盖。",
      "",
      "## 报告语言",
      "中文",
    ].join("\n")
  }

  private buildTestArtifactFromReviewContent(reviewContent: string): string {
    const scope = extractSectionBody(reviewContent, "## 检查范围", SECTION_RULES.review.sections).trim()
      || "待根据审查结果补充。"
    const findings = extractSectionBody(reviewContent, "## 发现的问题", SECTION_RULES.review.sections).trim()
      || "无"
    const severity = extractSectionBody(reviewContent, "## 问题严重度汇总", SECTION_RULES.review.sections).trim()
      || "blocker: 0"
    const regressionRisk = extractSectionBody(reviewContent, "## Regression 风险评估", SECTION_RULES.review.sections).trim()
      || "待根据审查结果补充。"

    return [
      "# 测试报告",
      "",
      "## 状态",
      "待判定",
      "",
      "## 轮次",
      "第 1 轮",
      "",
      "## 测试策略",
      "待 AI 根据 review 结果与实现风险补充测试策略，覆盖新增功能与受影响旧功能的回归验证。",
      "",
      "## 验证范围",
      scope,
      "",
      "## 测试概要",
      "待 AI 执行验证后补充。",
      "",
      "## 新增页面专项验证（如适用）",
      "不适用或待 AI 判定。",
      "",
      "## Figma 高保真验证（如适用）",
      "不适用或待 AI 判定。",
      "",
      "## Key Visual Elements 验证（如适用）",
      "不适用或待 AI 判定。",
      "",
      "## 失败项",
      findings,
      "",
      "## 历史遗留观察项（非阻塞，可选）",
      "无",
      "",
      "## Regression 验证",
      `${regressionRisk}\n\n待 AI 明确哪些旧功能需要回归验证以及验证结果。`,
      "",
      "## 覆盖范围",
      severity,
      "",
      "## 开发者决策建议",
      "待 AI 根据测试结果补充。",
      "",
      "## 结论",
      "待判定",
      "",
      "## 报告语言",
      "中文",
    ].join("\n")
  }

  private parseAnswerFromArtifact(content: string, heading: string): string | null {
    const body = extractSectionBody(content, heading, SECTION_RULES.spec_refinement.sections).trim()
    if (!body || containsUnresolvedMarker(body)) {
      return null
    }
    return body
  }

  async prepareForPhase(workflowId: string, phase: Phase, _previousPhase: Phase): Promise<void> {
    if (phase === "plan") {
      const refinementContent = await this.readPhaseArtifact(workflowId, "spec_refinement")
      await this.updatePhaseState(workflowId, "plan", {
        valid: true,
        readyForNextPhase: false,
        requiresApproval: true,
        summary: "Plan drafted and awaiting approval",
      })
      await this.writePhaseArtifact(
        workflowId,
        "plan",
        this.buildPlanArtifactFromRefinementContent(refinementContent),
      )
      return
    }

    if (phase === "develop") {
      const planContent = await this.readPhaseArtifact(workflowId, "plan")
      const developTemplate = this.buildDevelopArtifactFromPlanContent(planContent)
      await this.updatePhaseState(workflowId, "develop", {
        valid: false,
        readyForNextPhase: false,
        summary: "Development work is not complete yet",
        templateFingerprint: buildTemplateFingerprint(developTemplate),
      })
      await this.writePhaseArtifact(
        workflowId,
        "develop",
        developTemplate,
      )
      return
    }

    if (phase === "review") {
      const developContent = await this.readPhaseArtifact(workflowId, "develop")
      const runtime = await readJsonFile<WorkflowRuntimeState>(this.workspace.workflowRuntimeStateFile(workflowId))
      const reviewTemplate = this.buildReviewArtifactFromDevelopContent(developContent, runtime?.presetMode)
      await this.updatePhaseState(workflowId, "review", {
        valid: true,
        readyForNextPhase: false,
        summary: "Review report pending routing",
        reportStatus: "unknown",
        hasBlockingSeverity: false,
        templateFingerprint: buildTemplateFingerprint(reviewTemplate),
      })
      await this.writePhaseArtifact(
        workflowId,
        "review",
        reviewTemplate,
      )
      return
    }

    if (phase === "test") {
      const reviewContent = await this.readPhaseArtifact(workflowId, "review")
      const testTemplate = this.buildTestArtifactFromReviewContent(reviewContent)
      await this.updatePhaseState(workflowId, "test", {
        valid: true,
        readyForNextPhase: false,
        summary: "Test report pending routing",
        reportStatus: "unknown",
        hasBlockingSeverity: false,
        templateFingerprint: buildTemplateFingerprint(testTemplate),
      })
      await this.writePhaseArtifact(
        workflowId,
        "test",
        testTemplate,
      )
      return
    }
  }

  async resetPhaseForResync(workflowId: string, phase: Extract<Phase, "review" | "test">): Promise<void> {
    if (phase === "review") {
      const developContent = await this.readPhaseArtifact(workflowId, "develop")
      const runtime = await readJsonFile<WorkflowRuntimeState>(this.workspace.workflowRuntimeStateFile(workflowId))
      const reviewTemplate = this.buildReviewArtifactFromDevelopContent(developContent, runtime?.presetMode)
      await this.updatePhaseState(workflowId, "review", {
        valid: true,
        readyForNextPhase: false,
        summary: "Review report pending routing",
        reportStatus: "unknown",
        hasBlockingSeverity: false,
        missing: [],
        warnings: [],
        templateFingerprint: buildTemplateFingerprint(reviewTemplate),
      })
      await this.writePhaseArtifact(workflowId, "review", reviewTemplate)
      return
    }

    const reviewContent = await this.readPhaseArtifact(workflowId, "review")
    const testTemplate = this.buildTestArtifactFromReviewContent(reviewContent)
    await this.updatePhaseState(workflowId, "test", {
      valid: true,
      readyForNextPhase: false,
      summary: "Test report pending routing",
      reportStatus: "unknown",
      hasBlockingSeverity: false,
      missing: [],
      warnings: [],
      templateFingerprint: buildTemplateFingerprint(testTemplate),
    })
    await this.writePhaseArtifact(workflowId, "test", testTemplate)
  }

  async ensureDefault(workflowId: string, userRequest?: string): Promise<void> {
    await this.ensureDefaultForStartAt(workflowId, userRequest, "spec_refinement")
  }

  async ensureDefaultForStartAt(
    workflowId: string,
    userRequest: string | undefined,
    startAt: "spec_refinement" | "develop" | "review" | "test",
  ): Promise<void> {
    const existing = await readJsonFile<ArtifactStateFile>(this.workspace.artifactStateFile(workflowId))
    if (existing) {
      return
    }

    const normalizedUserRequest = this.normalizeUserRequest(userRequest)
    const syntheticRefinement = this.buildRefinementArtifact({
      userRequest: normalizedUserRequest,
      ...(startAt === "develop"
        ? {
            acceptanceAnswer: "Direct-develop workflow: user explicitly skipped refinement and plan. Implement the requested change directly, keep scope tight, and preserve review/test guardrails.",
          }
        : {}),
    })
    const syntheticPlan = this.buildPlanArtifactFromRefinementContent(syntheticRefinement)
    const syntheticDevelop = this.buildDevelopArtifactFromPlanContent(syntheticPlan)
    const refinementQuestions = this.buildSpecRefinementQuestionsFromSections({
      sectionBodies: this.defaultSpecSectionBodies(normalizedUserRequest),
      initialRequest: normalizedUserRequest,
    })

    const defaults: ArtifactStateFile = {
      spec_refinement: {
        valid: startAt === "review" || startAt === "test",
        readyForNextPhase: startAt === "review" || startAt === "test",
        summary: startAt === "review" || startAt === "test" ? "Audit source context prepared" : "Need clarification before planning",
        questions: startAt === "review" || startAt === "test" ? [] : refinementQuestions,
        initialRequest: normalizedUserRequest,
      },
      plan: {
        valid: true,
        readyForNextPhase: startAt === "review" || startAt === "test",
        requiresApproval: startAt !== "review" && startAt !== "test",
        summary: startAt === "review" || startAt === "test" ? "Audit source plan context prepared" : "Plan drafted and awaiting approval",
      },
      develop: {
        valid: startAt === "review" || startAt === "test",
        readyForNextPhase: startAt === "review" || startAt === "test",
        summary: startAt === "review" || startAt === "test" ? "Audit source develop context prepared" : "Development work is not complete yet",
      },
      review: {
        valid: true,
        readyForNextPhase: false,
        summary: "Review report pending routing",
        reportStatus: "unknown",
        hasBlockingSeverity: false,
      },
      test: {
        valid: true,
        readyForNextPhase: false,
        summary: "Test report pending routing",
        reportStatus: "unknown",
        hasBlockingSeverity: false,
      },
    }

    await writeJsonFile(this.workspace.artifactStateFile(workflowId), defaults)
    await this.writePhaseArtifact(
      workflowId,
      "spec_refinement",
      syntheticRefinement,
    )
    await this.writePhaseArtifact(
      workflowId,
      "plan",
      syntheticPlan,
    )
    await this.writePhaseArtifact(
      workflowId,
      "develop",
      syntheticDevelop,
    )
    await this.writePhaseArtifact(
      workflowId,
      "review",
      [
        "# 审查报告",
        "",
        "## 状态",
        "待判定",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 检查范围",
        "workflow harness MVP",
        "",
        "## 组件复用验收结果（如适用）",
        "不适用",
        "",
        "## Section 验收映射检查结果（如适用）",
        "不适用",
        "",
        "## 发现的问题",
        "待审查",
        "",
        "## 问题严重度汇总",
        "blocker: 0",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 风险评估",
        "待判定",
        "",
        "## 结论",
        "待判定",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )
    await this.writePhaseArtifact(
      workflowId,
      "test",
      [
        "# 测试报告",
        "",
        "## 状态",
        "待判定",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 测试策略",
        "以自动化和最小人工检查为主",
        "",
        "## 验证范围",
        "workflow harness 主链",
        "",
        "## 测试概要",
        "待执行",
        "",
        "## 新增页面专项验证（如适用）",
        "不适用",
        "",
        "## Figma 高保真验证（如适用）",
        "不适用",
        "",
        "## Key Visual Elements 验证（如适用）",
        "不适用",
        "",
        "## 失败项",
        "待测试",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 验证",
        "待判定",
        "",
        "## 覆盖范围",
        "phase transition / answer / approve / session idle",
        "",
        "## 开发者决策建议",
        "待判定",
        "",
        "## 结论",
        "待判定",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )
  }

  async evaluate(state: WorkflowState): Promise<ArtifactEvaluation> {
    const current = await this.getPhaseState(state.workflowId, state.phase)
    if (!current) {
      return {
        valid: false,
        readyForNextPhase: false,
        missing: ["artifact state missing"],
      }
    }

    let content = await this.readPhaseArtifact(state.workflowId, state.phase)
    let fromWorkspace = this.evaluatePhaseContent(state.phase, content)
    const runtime = await readJsonFile<WorkflowRuntimeState>(this.workspace.workflowRuntimeStateFile(state.workflowId))

    const hasUnchangedTemplateFingerprint = (state.phase === "develop" || state.phase === "review" || state.phase === "test")
      && typeof current.templateFingerprint === "string"
      && current.templateFingerprint === buildTemplateFingerprint(content)

    if (hasUnchangedTemplateFingerprint && !fromWorkspace.missing.includes("artifact_unchanged_from_template")) {
      fromWorkspace = {
        ...fromWorkspace,
        valid: false,
        readyForNextPhase: false,
        missing: [...fromWorkspace.missing, "artifact_unchanged_from_template"],
        summary: "开发报告仍包含模板占位内容，未满足完成条件",
      }
    }

    if (state.phase === "spec_refinement" && fromWorkspace.questions?.some((question) => question.canAutoResolve)) {
      const initialRequest = current.initialRequest ?? this.normalizeUserRequest(
        this.parseAnswerFromArtifact(content, "## 原始需求摘要") ?? undefined,
      )
      const autoFilledContent = this.autoFillSpecRefinementContent(content, initialRequest)
      if (autoFilledContent !== content) {
        await this.writePhaseArtifact(state.workflowId, "spec_refinement", autoFilledContent)
        content = autoFilledContent
        fromWorkspace = this.evaluatePhaseContent(state.phase, content)
        const refreshedHasUnchangedTemplateFingerprint = typeof current.templateFingerprint === "string"
          && current.templateFingerprint === buildTemplateFingerprint(content)
        if (refreshedHasUnchangedTemplateFingerprint && !fromWorkspace.missing.includes("artifact_unchanged_from_template")) {
          fromWorkspace = {
            ...fromWorkspace,
            valid: false,
            readyForNextPhase: false,
            missing: [...fromWorkspace.missing, "artifact_unchanged_from_template"],
            summary: "开发报告仍包含模板占位内容，未满足完成条件",
          }
        }
        const phasePatch: Partial<PhaseArtifactState> = {
          valid: fromWorkspace.valid ?? false,
          readyForNextPhase: fromWorkspace.readyForNextPhase ?? false,
          missing: fromWorkspace.missing,
          warnings: fromWorkspace.warnings,
          initialRequest,
        }
        if (fromWorkspace.summary) {
          phasePatch.summary = fromWorkspace.summary
        }
        if (fromWorkspace.questions) {
          phasePatch.questions = fromWorkspace.questions
        }
        await this.updatePhaseState(state.workflowId, "spec_refinement", {
          ...phasePatch,
        })
      }
    }

    if (state.phase === "develop" && runtime?.requiresCodeChangeBeforeDevelopComplete && fromWorkspace.readyForNextPhase) {
      const listedFiles = extractListedFilesFromDevelopArtifact(content)
      const hasNonArtifactChange = listedFiles.some((filePath) => !isArtifactOnlyListedFile(filePath))
      const baselineSnapshot = runtime.codeChangeFileSnapshotBaseline ?? null
      let hasRealWorkspaceChange = false

      try {
        const currentSnapshot = await buildWorkspaceCodeSnapshot(resolveCodeScanRoot(this.workspace.baseDir()))
        hasRealWorkspaceChange = countRealCodeChanges(currentSnapshot, baselineSnapshot, listedFiles) > 0
      } catch {
        fromWorkspace = {
          ...fromWorkspace,
          warnings: [...(fromWorkspace.warnings ?? []), "workspace_code_change_check_skipped"],
        }
      }

      if (!hasNonArtifactChange || !hasRealWorkspaceChange) {
        fromWorkspace = {
          ...fromWorkspace,
          valid: false,
          readyForNextPhase: false,
          missing: [...fromWorkspace.missing, "non_artifact_code_change_required_after_fix"],
          summary: hasNonArtifactChange
            ? "本次 develop 由 review/test 的 fix 决策回流，但 develop.md 中列出的非 artifact 文件未检测到相对回流基线的真实变更。请先修改这些实现或测试文件，再更新 develop 报告。"
            : "本次 develop 由 review/test 的 fix 决策回流，必须先修复实现代码或测试，再更新 develop 报告。当前 ## 修改文件 未包含任何非 artifact 文件。",
        }
      }
    }

    const result: ArtifactEvaluation = {
      valid: fromWorkspace.valid ?? current.valid,
      readyForNextPhase: fromWorkspace.readyForNextPhase ?? current.readyForNextPhase,
      missing: fromWorkspace.missing.length > 0 ? fromWorkspace.missing : current.missing ?? [],
      warnings: fromWorkspace.warnings && fromWorkspace.warnings.length > 0 ? fromWorkspace.warnings : current.warnings ?? [],
    }

    if (fromWorkspace.summary) {
      result.summary = fromWorkspace.summary
    } else if (current.summary) {
      result.summary = current.summary
    }
    if (fromWorkspace.questions) {
      result.questions = fromWorkspace.questions
    } else if (current.questions) {
      result.questions = current.questions
    }
    if (typeof fromWorkspace.requiresApproval === "boolean") {
      result.requiresApproval = fromWorkspace.requiresApproval
    } else if (typeof current.requiresApproval === "boolean") {
      result.requiresApproval = current.requiresApproval
    }
    if (typeof fromWorkspace.reportStatus === "string") {
      result.reportStatus = fromWorkspace.reportStatus
    } else if (typeof current.reportStatus === "string") {
      result.reportStatus = current.reportStatus
    }
    if (typeof fromWorkspace.hasBlockingSeverity === "boolean") {
      result.hasBlockingSeverity = fromWorkspace.hasBlockingSeverity
    } else if (typeof current.hasBlockingSeverity === "boolean") {
      result.hasBlockingSeverity = current.hasBlockingSeverity
    }

    return result
  }

  async answerQuestions(workflowId: string, answers: Record<string, string>): Promise<void> {
    const current = await this.readPhaseArtifact(workflowId, "spec_refinement")
    const currentState = await this.getPhaseState(workflowId, "spec_refinement")
    const initialRequest = currentState?.initialRequest ?? this.normalizeUserRequest(
      this.parseAnswerFromArtifact(current, "## 原始需求摘要") ?? undefined,
    )
    const sectionBodies = this.readSpecSectionBodies(current, initialRequest)

    for (const blueprint of SPEC_REFINEMENT_QUESTION_BLUEPRINTS) {
      const answer = answers[blueprint.id]?.trim()
      if (answer) {
        sectionBodies[blueprint.heading] = answer
      }
    }

    const finalBodies = this.finalizeSpecSectionBodies({
      sectionBodies,
      initialRequest,
      answers,
    })
    const nextContent = this.buildRefinementArtifactFromSections(finalBodies)
    const evaluation = this.evaluatePhaseContent("spec_refinement", nextContent)

    await this.updatePhaseState(workflowId, "spec_refinement", {
      valid: evaluation.valid ?? false,
      readyForNextPhase: evaluation.readyForNextPhase ?? false,
      summary: evaluation.summary ?? "Specification updated after answers",
      questions: evaluation.questions ?? [],
      missing: evaluation.missing,
      warnings: evaluation.warnings,
      initialRequest,
    })
    await this.writePhaseArtifact(workflowId, "spec_refinement", nextContent)
  }

  async markDevelopmentComplete(workflowId: string): Promise<void> {
    await this.updatePhaseState(workflowId, "develop", {
      valid: true,
      readyForNextPhase: true,
      summary: "Development complete",
      missing: [],
      warnings: [],
      templateFingerprint: null,
    })
    await this.writePhaseArtifact(
      workflowId,
      "develop",
      [
        "# 开发报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 修改文件",
        "packages/runtime/src/engine/default-workflow-engine.ts",
        "",
        "## 配套修改",
        "session activity monitor",
        "",
        "## 自检结果",
        "tests/typecheck/build 全通过",
        "",
        "## 备注",
        "无",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )
  }

  async setReviewReport(workflowId: string, status: "pass" | "fail", blocking = false): Promise<void> {
    await this.updatePhaseState(workflowId, "review", {
      valid: true,
      readyForNextPhase: false,
      summary: status === "pass" ? "Review report passed" : "Review report failed",
      reportStatus: status,
      hasBlockingSeverity: blocking,
    })

    const conclusionText = status === "pass" ? "通过" : "失败"
    const severitySummary = blocking ? "[severity:blocker] blocking issue found" : "blocker: 0"
    await this.writePhaseArtifact(
      workflowId,
      "review",
      [
        "# 审查报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 检查范围",
        "workflow harness MVP",
        "",
        "## 组件复用验收结果（如适用）",
        "不适用",
        "",
        "## Section 验收映射检查结果（如适用）",
        "不适用",
        "",
        "## 发现的问题",
        status === "fail" ? "存在待处理问题" : "无",
        "",
        "## 问题严重度汇总",
        severitySummary,
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 风险评估",
        blocking ? "高" : "低",
        "",
        "## 结论",
        conclusionText,
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )
  }

  async setTestReport(workflowId: string, status: "pass" | "fail"): Promise<void> {
    await this.updatePhaseState(workflowId, "test", {
      valid: true,
      readyForNextPhase: false,
      summary: status === "pass" ? "Test report passed" : "Test report failed",
      reportStatus: status,
      hasBlockingSeverity: false,
    })

    const conclusionText = status === "pass" ? "通过" : "失败"
    await this.writePhaseArtifact(
      workflowId,
      "test",
      [
        "# 测试报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 测试策略",
        "以自动化和最小人工检查为主",
        "",
        "## 验证范围",
        "workflow harness 主链",
        "",
        "## 测试概要",
        status === "pass" ? "主链通过" : "测试存在失败项",
        "",
        "## 新增页面专项验证（如适用）",
        "不适用",
        "",
        "## Figma 高保真验证（如适用）",
        "不适用",
        "",
        "## Key Visual Elements 验证（如适用）",
        "不适用",
        "",
        "## 失败项",
        status === "pass" ? "无" : "存在失败项，需要人工决策",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 验证",
        status === "pass" ? "通过" : "未通过",
        "",
        "## 覆盖范围",
        "phase transition / answer / approve / session idle",
        "",
        "## 开发者决策建议",
        status === "pass" ? "可继续推进" : "建议人工决定是否回到 develop",
        "",
        "## 结论",
        conclusionText,
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )
  }

  private async getPhaseState(workflowId: string, phase: Phase): Promise<PhaseArtifactState | null> {
    const file = await readJsonFile<ArtifactStateFile>(this.workspace.artifactStateFile(workflowId))
    return file?.[phase] ?? null
  }

  private async updatePhaseState(
    workflowId: string,
    phase: Phase,
    patch: Omit<Partial<PhaseArtifactState>, "templateFingerprint"> & { templateFingerprint?: string | null },
  ): Promise<void> {
    const current = (await readJsonFile<ArtifactStateFile>(this.workspace.artifactStateFile(workflowId))) ?? {}
    const existing = current[phase] ?? {
      valid: false,
      readyForNextPhase: false,
    }
    const { templateFingerprint, ...restPatch } = patch
    current[phase] = {
      ...existing,
      ...restPatch,
      ...(typeof templateFingerprint === "string" ? { templateFingerprint } : {}),
    }
    const nextPhase = current[phase]
    if (templateFingerprint === null && nextPhase) {
      delete nextPhase.templateFingerprint
    }
    await writeJsonFile(this.workspace.artifactStateFile(workflowId), current)
  }

  private async readPhaseArtifact(workflowId: string, phase: Phase): Promise<string> {
    try {
      return await readFile(this.workspace.phaseArtifactFile(workflowId, phase), "utf8")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("ENOENT")) {
        return ""
      }
      throw error
    }
  }

  private async writePhaseArtifact(workflowId: string, phase: Phase, content: string): Promise<void> {
    await writeFile(this.workspace.phaseArtifactFile(workflowId, phase), `${content}\n`, "utf8")
  }

  private evaluatePhaseContent(
    phase: Phase,
    content: string,
  ): Partial<ArtifactEvaluation> & { missing: string[]; warnings: string[] } {
    if (!content.trim()) {
      return { valid: false, readyForNextPhase: false, missing: ["artifact file is empty"], warnings: [] }
    }

    const sectionRule = phase === "spec_refinement"
      || phase === "plan"
      || phase === "develop"
      || phase === "review"
      || phase === "test"
      ? SECTION_RULES[phase]
      : null

    if (sectionRule) {
      const missing = [] as string[]
      const warnings = [] as string[]
      const nonBlockingSections = new Set(
        (phase === "develop" || phase === "review" || phase === "test")
          ? NON_BLOCKING_SECTIONS[phase] ?? []
          : [],
      )

      if (!content.includes(sectionRule.title)) {
        missing.push(sectionRule.title)
      }

      missing.push(...findOutOfOrderHeadings(content, [sectionRule.title, ...sectionRule.sections]))

      for (const section of sectionRule.sections) {
        if (isOptionalSection(section)) {
          continue
        }
        if (!content.includes(section) || !sectionHasContent(content, section, sectionRule.sections)) {
          if (nonBlockingSections.has(section)) {
            warnings.push(section)
            continue
          }
          missing.push(section)
        }
      }

      if (phase === "spec_refinement") {
        if (!hasReadyForPlanConclusion(content, sectionRule.sections)) {
          missing.push("## 准入结论: READY_FOR_PLAN")
        }
        if (!questionChecklistResolved(content, sectionRule.sections)) {
          missing.push("## 疑问清单: ALL_RESOLVED")
        }
      }

      if (phase === "develop" && !hasCompletedStatus(content, sectionRule.sections)) {
        missing.push("## 状态: COMPLETED")
      }

      if (phase === "test" && getReportStatus(content) === "pass" && !hasSufficientTestEvidence(content, sectionRule.sections)) {
        missing.push("## 测试证据: SUFFICIENT")
      }

      if (missing.length > 0) {
        if (phase === "spec_refinement") {
          const currentBodies = this.readSpecSectionBodies(content)
          const summaryBody = currentBodies["## 原始需求摘要"] ?? ""
          const initialRequest = this.normalizeUserRequest(
            !containsUnresolvedMarker(summaryBody) ? summaryBody : undefined,
          )
          const questions = this.buildSpecRefinementQuestionsFromSections({
            sectionBodies: currentBodies,
            initialRequest,
          })
          return {
            valid: false,
            readyForNextPhase: false,
            missing,
            warnings,
            summary: "规格精炼报告未满足进入 plan 的要求",
            ...(questions.length > 0 ? { questions } : {}),
          }
        }

        if (phase === "plan") {
          return {
            valid: false,
            readyForNextPhase: false,
            missing,
            warnings,
            requiresApproval: false,
            summary: "开发计划结构不完整，暂不能进入审批",
          }
        }

        if (phase === "review") {
          return {
            valid: false,
            readyForNextPhase: false,
            missing,
            warnings,
            summary: "审查报告结构不完整，暂不能决定 pass/fail",
            reportStatus: getReportStatus(content),
            hasBlockingSeverity: hasBlockingSeverity(content),
          }
        }

        if (phase === "test") {
          return {
            valid: false,
            readyForNextPhase: false,
            missing,
            warnings,
            summary: "测试报告证据不足，暂不能决定 pass/fail",
            reportStatus: getReportStatus(content),
            hasBlockingSeverity: false,
          }
        }

        return {
          valid: false,
          readyForNextPhase: false,
          missing,
          warnings,
          summary: "开发报告未满足完成条件",
        }
      }

      if (warnings.length > 0) {
        if (phase === "develop") {
          return {
            valid: true,
            readyForNextPhase: true,
            missing: [],
            warnings,
            summary: "Development complete",
          }
        }

        if (phase === "review") {
          return {
            valid: true,
            readyForNextPhase: false,
            missing: [],
            warnings,
            summary: "Review report is ready for routing",
            reportStatus: getReportStatus(content),
            hasBlockingSeverity: hasBlockingSeverity(content),
          }
        }

        if (phase === "test") {
          return {
            valid: true,
            readyForNextPhase: false,
            missing: [],
            warnings,
            summary: "Test report is ready for routing",
            reportStatus: getReportStatus(content),
            hasBlockingSeverity: false,
          }
        }
      }
    }

    if (phase === "spec_refinement") {
      return {
        valid: true,
        readyForNextPhase: true,
        missing: [],
        warnings: [],
        summary: "Spec refinement is ready for planning",
        questions: [],
      }
    }

    if (phase === "plan") {
      return {
        valid: true,
        readyForNextPhase: false,
        missing: [],
        warnings: [],
        requiresApproval: true,
        summary: "Plan drafted and awaiting approval",
      }
    }

    if (phase === "develop") {
      return {
        valid: true,
        readyForNextPhase: true,
        missing: [],
        warnings: [],
        summary: "Development complete",
      }
    }

    if (phase === "review") {
      return {
        valid: true,
        readyForNextPhase: false,
        missing: [],
        warnings: [],
        summary: "Review report is ready for routing",
        reportStatus: getReportStatus(content),
        hasBlockingSeverity: hasBlockingSeverity(content),
      }
    }

    if (phase === "test") {
      return {
        valid: true,
        readyForNextPhase: false,
        missing: [],
        warnings: [],
        summary: "Test report is ready for routing",
        reportStatus: getReportStatus(content),
        hasBlockingSeverity: false,
      }
    }

    return { valid: false, readyForNextPhase: false, missing: [], warnings: [] }
  }
}
