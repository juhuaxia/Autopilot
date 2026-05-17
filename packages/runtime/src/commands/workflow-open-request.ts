import { access, readdir, readFile } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import type { WorkflowPresetMode } from "../../../core/src/state/workflow-runtime-state"
import { isAutopilotPresetMode } from "./autopilot-presets"
import { AUTOPILOT_COMMAND_BRIDGE_PROMPT } from "./autopilot-command-presets"
import type { ImageSummaryService } from "../images/image-summary-service"

const MAX_DOC_CHARS = 12_000
const MAX_CANDIDATE_DOCS = 20
const MAX_SCAN_DEPTH = 3
const MAX_READ_TARGET_IMAGES = 5
const MAX_IMAGE_SUMMARY_CONCURRENCY = 2
const DOC_EXTENSIONS = [".md", ".markdown", ".txt", ".rst", ".adoc", ".pdf", ".docx"]
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"]
const COMMON_DOC_DIRS = ["docs", "doc", "spec", "specs", "design", "prd", "product", "requirements"]
const READ_TARGET_PATTERN = /@read\(([^)]+)\)/g
const AP_START_AT_PATTERN = /^\s*\/ap-start-at\s*:\s*(develop)\s*$/i
const AP_DOC_PATTERN = /^\s*\/ap-doc\s*:\s*(.+?)\s*$/i
const AP_MODE_PATTERN = /^\s*\/ap-mode\s*:\s*([\w-]+)\s*$/i

type ReadTargetKind = "text" | "image" | "unknown"

type WorkflowOpenRequestJson = {
  prompt?: string
  docPaths?: string[]
  projectContext?: string
  startAt?: "develop"
  mode?: WorkflowPresetMode
}

/**
 * Result of detecting a continuation-type ambiguous command like
 * "继续下一步", "继续", "接着做", "往下走".
 *
 * These commands are NOT natural workflow_open triggers — they need
 * context-aware routing based on pending human actions, active workflows,
 * and whether a workflow was recently proposed.
 */
export type ContinuationIntent = {
  /** The raw trimmed payload that was detected as a continuation command */
  rawPayload: string
  /** Which continuation pattern matched */
  matchedPattern: string
}

export interface WorkflowOpenRequest {
  userRequest: string
  prompt: string
  startAt?: "develop"
  mode?: WorkflowPresetMode
  docPaths: string[]
  readTargets: Array<{ raw: string; path: string; kind: ReadTargetKind }>
  textReadTargets: Array<{ path: string; content: string }>
  imageReadTargets: Array<{ path: string }>
  projectContext?: string
  needsClarification: boolean
  clarificationQuestion?: string
  clarificationOptions?: string[]
  /**
   * Populated when the payload looks like a continuation-type command
   * (e.g. "继续下一步", "接着做"). Null for normal workflow-open payloads.
   * The command runner uses this to apply 4-rule routing instead of
   * the standard open flow.
   */
  continuationIntent?: ContinuationIntent | null
}

const trimToEmpty = (value: string | undefined): string => value?.trim() ?? ""

function isEmptyAutopilotCommandBridge(prompt: string, rawPayload: string): boolean {
  const normalizedPrompt = trimToEmpty(prompt)
  if (!normalizedPrompt) {
    return false
  }

  const rawLines = rawPayload
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const directiveLineCount = rawLines.filter((line) =>
    AP_START_AT_PATTERN.test(line) || AP_MODE_PATTERN.test(line),
  ).length

  return normalizedPrompt === AUTOPILOT_COMMAND_BRIDGE_PROMPT
    && rawLines.length > 0
    && rawLines[0] === AUTOPILOT_COMMAND_BRIDGE_PROMPT
    && rawLines.length <= directiveLineCount + 1
 }

const hasDocExtension = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return DOC_EXTENSIONS.some((extension) => normalized.endsWith(extension))
}

const hasImageExtension = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return IMAGE_EXTENSIONS.some((extension) => normalized.endsWith(extension))
}

function classifyReadTarget(pathValue: string): ReadTargetKind {
  if (hasDocExtension(pathValue)) {
    return "text"
  }
  if (hasImageExtension(pathValue)) {
    return "image"
  }
  return "unknown"
}

function extractReadTargets(value: string): Array<{ raw: string; path: string; kind: ReadTargetKind }> {
  const targets: Array<{ raw: string; path: string; kind: ReadTargetKind }> = []
  for (const match of value.matchAll(READ_TARGET_PATTERN)) {
    const raw = match[0]?.trim()
    const path = match[1]?.trim()
    if (!raw || !path) {
      continue
    }
    targets.push({
      raw,
      path,
      kind: classifyReadTarget(path),
    })
  }
  return targets
}

const normalizeDocumentLikeInput = (value: string): string =>
  value.trim().replace(/^文档\s*[:：]?\s*/i, "")

const isAutopilotDirectiveLine = (value: string): boolean =>
  AP_START_AT_PATTERN.test(value.trim()) || AP_DOC_PATTERN.test(value.trim()) || AP_MODE_PATTERN.test(value.trim())

function extractNaturalLanguageDirectives(rawPayload: string): {
  prompt: string
  docPaths: string[]
  startAt?: "develop"
  mode?: WorkflowPresetMode
  hasExplicitAutopilotDirective: boolean
} {
  const docPaths: string[] = []
  let startAt: "develop" | undefined
  let mode: WorkflowPresetMode | undefined
  let hasExplicitAutopilotDirective = false
  const prompt = rawPayload
    .split("\n")
    .map((line) => {
      const trimmed = line.trim()
      const startAtMatch = trimmed.match(AP_START_AT_PATTERN)
      if (startAtMatch?.[1]?.toLowerCase() === "develop") {
        startAt = "develop"
        hasExplicitAutopilotDirective = true
        return ""
      }

      const modeMatch = trimmed.match(AP_MODE_PATTERN)
      if (modeMatch?.[1] && isAutopilotPresetMode(modeMatch[1])) {
        mode = modeMatch[1]
        hasExplicitAutopilotDirective = true
        return ""
      }

      const docMatch = trimmed.match(AP_DOC_PATTERN)
      if (docMatch?.[1]) {
        const normalizedPath = docMatch[1].trim()
        if (normalizedPath && hasDocExtension(normalizedPath)) {
          docPaths.push(normalizedPath)
          hasExplicitAutopilotDirective = true
          return ""
        }
      }

      return trimmed.replace(/^[,，;；]+|[,，;；]+$/g, "")
    })
    .filter((line) => line.length > 0)
    .join("\n")

  return {
    prompt,
    docPaths: [...new Set(docPaths)],
    hasExplicitAutopilotDirective,
    ...(mode ? { mode } : {}),
    ...(startAt ? { startAt } : {}),
  }
}

const looksLikeDocumentReference = (value: string): boolean => {
  if (isAutopilotDirectiveLine(value)) {
    return false
  }
  const normalized = normalizeDocumentLikeInput(value)
  if (!normalized) {
    return false
  }
  if (!hasDocExtension(normalized)) {
    return false
  }
  return normalized.startsWith("/")
    || normalized.startsWith("./")
    || normalized.startsWith("../")
    || normalized.includes("/")
    || normalized.includes("\\")
}


const parseStructuredRequest = (payload: string): WorkflowOpenRequestJson | null => {
  try {
    const parsed = JSON.parse(payload) as unknown
    if (!parsed || typeof parsed !== "object") {
      return null
    }

    const prompt = typeof (parsed as { prompt?: unknown }).prompt === "string"
      ? (parsed as { prompt: string }).prompt
      : undefined
    const projectContext = typeof (parsed as { projectContext?: unknown }).projectContext === "string"
      ? (parsed as { projectContext: string }).projectContext
      : undefined
    const docPaths = Array.isArray((parsed as { docPaths?: unknown }).docPaths)
      ? (parsed as { docPaths: unknown[] }).docPaths.filter((item): item is string => typeof item === "string")
      : undefined
    const startAt = (parsed as { startAt?: unknown }).startAt === "develop"
      ? "develop"
      : undefined
    const rawMode = (parsed as { mode?: unknown }).mode
    const mode = typeof rawMode === "string" && isAutopilotPresetMode(rawMode)
      ? rawMode as WorkflowPresetMode
      : undefined

    const hasKnownKey = prompt !== undefined || projectContext !== undefined || docPaths !== undefined || startAt !== undefined || mode !== undefined
    if (!hasKnownKey) {
      return null
    }

    return {
      ...(prompt !== undefined ? { prompt } : {}),
      ...(projectContext !== undefined ? { projectContext } : {}),
      ...(docPaths !== undefined ? { docPaths } : {}),
      ...(startAt !== undefined ? { startAt } : {}),
      ...(mode !== undefined ? { mode } : {}),
    }
  } catch {
    return null
  }
}

const toAbsolutePath = (pathValue: string, workspaceRoot: string): string =>
  isAbsolute(pathValue) ? pathValue : resolve(workspaceRoot, pathValue)

const normalizeDocSnippet = (content: string): string => {
  const normalized = content.replace(/\r\n/g, "\n").trim()
  if (normalized.length <= MAX_DOC_CHARS) {
    return normalized
  }
  return `${normalized.slice(0, MAX_DOC_CHARS)}\n... (truncated)`
}

const toRelativePath = (workspaceRoot: string, absolutePath: string): string => {
  const normalizedRoot = workspaceRoot.endsWith("/") ? workspaceRoot : `${workspaceRoot}/`
  return absolutePath.startsWith(normalizedRoot)
    ? absolutePath.slice(normalizedRoot.length)
    : absolutePath
}

const listDocCandidatesFromDir = async (
  baseDir: string,
  workspaceRoot: string,
  depth: number,
  output: string[],
): Promise<void> => {
  if (depth > MAX_SCAN_DEPTH || output.length >= MAX_CANDIDATE_DOCS) {
    return
  }

  try {
    await access(baseDir)
  } catch {
    return
  }

  const dirEntries = await readdir(baseDir, { withFileTypes: true })
  const sorted = [...dirEntries].sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of sorted) {
    if (output.length >= MAX_CANDIDATE_DOCS) {
      return
    }
    if (entry.name.startsWith(".")) {
      continue
    }
    const childPath = resolve(baseDir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue
      }
      await listDocCandidatesFromDir(childPath, workspaceRoot, depth + 1, output)
      continue
    }
    if (entry.isFile() && hasDocExtension(entry.name)) {
      output.push(toRelativePath(workspaceRoot, childPath))
    }
  }
}

const discoverCandidateDocs = async (workspaceRoot: string): Promise<string[]> => {
  const candidates: string[] = []
  for (const dirName of COMMON_DOC_DIRS) {
    if (candidates.length >= MAX_CANDIDATE_DOCS) {
      break
    }
    const targetDir = resolve(workspaceRoot, dirName)
    await listDocCandidatesFromDir(targetDir, workspaceRoot, 0, candidates)
  }
  return [...new Set(candidates)].slice(0, MAX_CANDIDATE_DOCS)
}

const actionHints = [
  "开始",
  "启动",
  "执行",
  "推进",
  "分析",
  "提炼",
  "整理",
  "生成",
  "新增",
  "添加",
  "实现",
  "开发",
  "支持",
  "优化",
  "修复",
  "改造",
  "重构",
  "需求",
  "workflow",
  "工作流",
  "流程",
  "review",
  "plan",
  "develop",
  "test",
]

/**
 * Continuation-type patterns that indicate the user wants to "continue"
 * rather than start something new.
 *
 * Deliberately NOT added to actionHints — these must go through
 * 4-rule routing in the command runner, not the standard open flow.
 */
const continuationPatterns = [
  "继续下一步",
  "继续做",
  "接着做",
  "往下走",
  "继续",
]

const continuationNegationPrefixes = [
  "不要",
  "先不要",
  "别",
  "先别",
  "不",
]

function isNegatedContinuationPayload(payload: string): boolean {
  return continuationNegationPrefixes.some((prefix) => continuationPatterns.some((pattern) => payload.startsWith(`${prefix}${pattern}`)))
}

export function detectContinuationIntent(rawPayload: string): ContinuationIntent | null {
  const trimmed = rawPayload.trim()
  if (!trimmed || trimmed.length > 100) {
    return null
  }
  const lower = trimmed.toLowerCase()
  if (isNegatedContinuationPayload(lower)) {
    return null
  }
  const matched = continuationPatterns.find((pattern) => lower.includes(pattern.toLowerCase()) || lower === pattern.toLowerCase())
  if (!matched) {
    return null
  }
  if (actionHints.some((hint) => lower.includes(hint.toLowerCase()))) {
    return null
  }
  return { rawPayload: trimmed, matchedPattern: matched }
}

function inferOpenIntent(args: {
  rawPayload: string
  prompt: string
  docPaths: string[]
  hasExplicitAutopilotDirective: boolean
  hasStructuredRequest: boolean
}): {
  needsClarification: boolean
  clarificationQuestion?: string
  clarificationOptions?: string[]
} {
  const { rawPayload, prompt, docPaths, hasExplicitAutopilotDirective, hasStructuredRequest } = args
  const lower = rawPayload.toLowerCase()
  const hasActionHint = actionHints.some((hint) => lower.includes(hint.toLowerCase()))
  const onlyDocLikeInput = docPaths.length > 0 && !hasActionHint && prompt.length < 20
  const explicitDocReference = looksLikeDocumentReference(rawPayload)

  if (explicitDocReference || hasExplicitAutopilotDirective || hasStructuredRequest) {
    return { needsClarification: false }
  }

  if (!hasActionHint || onlyDocLikeInput) {
    return {
      needsClarification: true,
      clarificationQuestion: "我看到你给了一个文档，但还不确定你希望我做什么。你想怎么处理？",
      clarificationOptions: [
        "1. 直接启动 workflow",
        "2. 先分析并提炼需求",
        "3. 先补全文档再决定",
        "4. 只看文档，不启动 workflow",
      ],
    }
  }

  return { needsClarification: false }
}

export async function buildWorkflowOpenRequest(payload: string | undefined, workspaceRoot: string): Promise<WorkflowOpenRequest> {
  return buildWorkflowOpenRequestWithOptions(payload, workspaceRoot, {})
}

export async function buildWorkflowOpenRequestWithOptions(
  payload: string | undefined,
  workspaceRoot: string,
  options: { imageSummaryService?: ImageSummaryService },
): Promise<WorkflowOpenRequest> {
  const rawPayload = trimToEmpty(payload)
  const structured = rawPayload ? parseStructuredRequest(rawPayload) : null
  const naturalLanguageDirectives = structured ? null : extractNaturalLanguageDirectives(rawPayload)
  const explicitDocumentReference = looksLikeDocumentReference(rawPayload)

  const effectivePrompt = trimToEmpty(structured?.prompt)
    || trimToEmpty(naturalLanguageDirectives?.prompt)
  let prompt = effectivePrompt
  const mode = structured?.mode ?? naturalLanguageDirectives?.mode
  const modeDefaultStartAt = mode === "light" ? "develop" : undefined
  if (explicitDocumentReference) {
    prompt = `请基于这份文档启动 workflow。\n${normalizeDocumentLikeInput(rawPayload)}`
  } else if (!prompt && (naturalLanguageDirectives?.docPaths.length ?? 0) > 0) {
    prompt = (naturalLanguageDirectives?.startAt ?? modeDefaultStartAt) === "develop"
      ? "请基于需求文档直接进入 develop。"
      : "请基于需求文档启动 workflow。"
  } else if (!prompt && (naturalLanguageDirectives?.startAt ?? modeDefaultStartAt) === "develop") {
    prompt = "请直接进入 develop。"
  } else if (!prompt && mode === "safe") {
    prompt = "请启动严格审查模式的 workflow。"
  } else if (!prompt && mode === "debug") {
    prompt = "请启动问题排查与修复模式的 workflow。"
  } else if (!prompt && mode === "standard") {
    prompt = "请启动标准模式的 workflow。"
  } else if (!prompt) {
    prompt = rawPayload
  }
  const structuredDocPaths = (structured?.docPaths ?? []).map((item) => item.trim()).filter((item) => item.length > 0)
  const directiveDocPaths = naturalLanguageDirectives?.docPaths ?? []
  const startAt = structured?.startAt ?? naturalLanguageDirectives?.startAt ?? modeDefaultStartAt
  const docPaths = [...new Set([...structuredDocPaths, ...directiveDocPaths])]
  const emptyAutopilotCommandBridge = isEmptyAutopilotCommandBridge(prompt, rawPayload)
  const shouldRecallCandidates = !structured && docPaths.length === 0
  const candidateDocs = shouldRecallCandidates ? await discoverCandidateDocs(workspaceRoot) : []
  const projectContext = trimToEmpty(structured?.projectContext)
    || undefined
  const intent = inferOpenIntent({
    rawPayload,
    prompt,
    docPaths,
    hasExplicitAutopilotDirective: naturalLanguageDirectives?.hasExplicitAutopilotDirective ?? false,
    hasStructuredRequest: structured !== null,
  })
  const continuationIntent = detectContinuationIntent(rawPayload)
  const readTargets = extractReadTargets(prompt)
  const textReadTargets: Array<{ path: string; content: string }> = []
  const imageReadTargets: Array<{ path: string }> = []

  const lines: string[] = []
  if (mode) {
    lines.push("[AUTOPILOT_PRESET]")
    lines.push(`mode=${mode}`)
    if (startAt) {
      lines.push(`startAt=${startAt}`)
    }
    lines.push("[AUTOPILOT_PRESET_POLICY] This preset came from an OpenCode slash command or explicit Autopilot directive. Honor it when choosing workflow depth and phase entry.")
    lines.push("")
  }
  lines.push("[USER_PROMPT]")
  lines.push(prompt || "请先基于项目和需求文档完成 spec_refinement。")

  if (projectContext) {
    lines.push("")
    lines.push("[PROJECT_CONTEXT]")
    lines.push(projectContext)
  }

  if (docPaths.length > 0) {
    lines.push("")
    lines.push("[REFERENCE_DOCS]")
    for (const rawPath of docPaths) {
      const absolutePath = toAbsolutePath(rawPath, workspaceRoot)
      try {
        const content = await readFile(absolutePath, "utf8")
        lines.push("")
        lines.push(`[DOC_PATH] ${rawPath}`)
        lines.push("[DOC_CONTENT]")
        lines.push(normalizeDocSnippet(content))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        lines.push("")
        lines.push(`[DOC_PATH] ${rawPath}`)
        lines.push(`[DOC_READ_ERROR] ${message}`)
      }
    }
  }

  if (candidateDocs.length > 0) {
    lines.push("")
    lines.push("[DOC_CANDIDATES]")
    lines.push(...candidateDocs.map((item) => `- ${item}`))
    lines.push("[DOC_CANDIDATES_POLICY] Candidate list is recall-only. AI must decide relevance and read selected docs before filling artifact.")
  }

  if (readTargets.length > 0) {
    lines.push("")
    lines.push("[READ_TARGETS]")
    lines.push(...readTargets.map((target) => `- type=${target.kind} path=${target.path}`))
    lines.push("[READ_TARGETS_POLICY] These targets were explicitly marked with @read(...). spec_refinement and plan must treat them as explicit read targets. Later phases should rely on the structured outputs produced earlier instead of re-reading them by default.")

    for (const target of readTargets) {
      if (target.kind === "text") {
        const absolutePath = toAbsolutePath(target.path, workspaceRoot)
        try {
          const content = await readFile(absolutePath, "utf8")
          textReadTargets.push({
            path: target.path,
            content: normalizeDocSnippet(content),
          })
          lines.push("")
          lines.push(`[READ_TARGET_PATH] ${target.path}`)
          lines.push("[READ_TARGET_CONTENT]")
          lines.push(normalizeDocSnippet(content))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          lines.push("")
          lines.push(`[READ_TARGET_PATH] ${target.path}`)
          lines.push(`[READ_TARGET_ERROR] ${message}`)
        }
        continue
      }

    }

    const imageTargetsToRead = readTargets.filter((target) => target.kind === "image").slice(0, MAX_READ_TARGET_IMAGES)
    if (readTargets.filter((target) => target.kind === "image").length > MAX_READ_TARGET_IMAGES) {
      lines.push("")
      lines.push(`[READ_TARGET_WARNING] only the first ${MAX_READ_TARGET_IMAGES} image read targets were analyzed`)
    }

    const imageResults = await runWithConcurrency(imageTargetsToRead, MAX_IMAGE_SUMMARY_CONCURRENCY, async (target) => {
      imageReadTargets.push({ path: target.path })
      const absolutePath = toAbsolutePath(target.path, workspaceRoot)
      if (!options.imageSummaryService) {
        return {
          path: target.path,
          ok: false,
          error: "image understanding unavailable in current environment",
        }
      }
      try {
        const result = await options.imageSummaryService.summarize(absolutePath)
        return {
          path: target.path,
          ok: result.ok,
          summary: result.summary,
          error: result.error,
        }
      } catch (error) {
        return {
          path: target.path,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    for (const result of imageResults) {
      lines.push("")
      lines.push(`[READ_TARGET_IMAGE_PATH] ${result.path}`)
      if (result.ok && result.summary?.trim()) {
        lines.push("[READ_TARGET_IMAGE_SUMMARY]")
        lines.push(condenseImageSummary(result.summary.trim()))
      } else {
        lines.push(`[READ_TARGET_IMAGE_ERROR] ${result.error ?? "image understanding unavailable in current environment"}`)
      }
    }
  }

  return {
    userRequest: lines.join("\n"),
    prompt,
    ...(startAt ? { startAt } : {}),
    ...(mode ? { mode } : {}),
    docPaths,
    readTargets,
    textReadTargets,
    imageReadTargets,
    needsClarification: emptyAutopilotCommandBridge ? true : intent.needsClarification,
    ...((emptyAutopilotCommandBridge || intent.clarificationQuestion)
      ? { clarificationQuestion: emptyAutopilotCommandBridge ? "`/ap-*` 命令后还没有实际需求内容。请在命令后补充你要执行的任务。" : intent.clarificationQuestion }
      : {}),
    ...((emptyAutopilotCommandBridge || intent.clarificationOptions)
      ? { clarificationOptions: emptyAutopilotCommandBridge ? ["示例：/ap-light 根据 docs/requirement.md 修复登录按钮文案"] : intent.clarificationOptions }
      : {}),
    ...(projectContext ? { projectContext } : {}),
    ...(continuationIntent ? { continuationIntent } : {}),
  }
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let index = 0

  const runWorker = async (): Promise<void> => {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      const item = items[currentIndex]
      if (item === undefined) {
        continue
      }
      results[currentIndex] = await worker(item)
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker())
  await Promise.all(workers)
  return results
}

function condenseImageSummary(summary: string): string {
  const lines = summary
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const condensed = lines.join("\n")
  if (condensed.length <= 3000) {
    return condensed
  }
  return `${condensed.slice(0, 3000)}\n[IMAGE_SUMMARY_NOTE] condensed to fit prompt budget`
}
