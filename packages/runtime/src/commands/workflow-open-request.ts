import { access, readdir, readFile } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"

const MAX_DOC_CHARS = 12_000
const MAX_CANDIDATE_DOCS = 20
const MAX_SCAN_DEPTH = 3
const DOC_EXTENSIONS = [".md", ".markdown", ".txt", ".rst", ".adoc", ".pdf", ".docx"]
const COMMON_DOC_DIRS = ["docs", "doc", "spec", "specs", "design", "prd", "product", "requirements"]

type WorkflowOpenRequestJson = {
  prompt?: string
  docPaths?: string[]
  projectContext?: string
}

export interface WorkflowOpenRequest {
  userRequest: string
  prompt: string
  docPaths: string[]
  projectContext?: string
  needsClarification: boolean
  clarificationQuestion?: string
  clarificationOptions?: string[]
}

const trimToEmpty = (value: string | undefined): string => value?.trim() ?? ""

const hasDocExtension = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return DOC_EXTENSIONS.some((extension) => normalized.endsWith(extension))
}

const normalizeDocumentLikeInput = (value: string): string =>
  value.trim().replace(/^文档\s*[:：]?\s*/i, "")

const looksLikeDocumentReference = (value: string): boolean => {
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

    const hasKnownKey = prompt !== undefined || projectContext !== undefined || docPaths !== undefined
    if (!hasKnownKey) {
      return null
    }

    return {
      ...(prompt !== undefined ? { prompt } : {}),
      ...(projectContext !== undefined ? { projectContext } : {}),
      ...(docPaths !== undefined ? { docPaths } : {}),
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

function inferOpenIntent(rawPayload: string, prompt: string, docPaths: string[]): {
  needsClarification: boolean
  clarificationQuestion?: string
  clarificationOptions?: string[]
} {
  const lower = rawPayload.toLowerCase()
  const hasActionHint = actionHints.some((hint) => lower.includes(hint.toLowerCase()))
  const onlyDocLikeInput = docPaths.length > 0 && !hasActionHint && prompt.length < 20
  const explicitDocReference = looksLikeDocumentReference(rawPayload)

  if (explicitDocReference) {
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
  const rawPayload = trimToEmpty(payload)
  const structured = rawPayload ? parseStructuredRequest(rawPayload) : null

  const prompt = trimToEmpty(structured?.prompt)
    || (looksLikeDocumentReference(rawPayload)
      ? `请基于这份文档启动 workflow。\n${normalizeDocumentLikeInput(rawPayload)}`
      : rawPayload)
  const structuredDocPaths = (structured?.docPaths ?? []).map((item) => item.trim()).filter((item) => item.length > 0)
  const docPaths = structuredDocPaths
  const shouldRecallCandidates = !structured && docPaths.length === 0
  const candidateDocs = shouldRecallCandidates ? await discoverCandidateDocs(workspaceRoot) : []
  const projectContext = trimToEmpty(structured?.projectContext)
    || undefined
  const intent = inferOpenIntent(rawPayload, prompt, docPaths)

  const lines: string[] = []
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

  return {
    userRequest: lines.join("\n"),
    prompt,
    docPaths,
    needsClarification: intent.needsClarification,
    ...(intent.clarificationQuestion ? { clarificationQuestion: intent.clarificationQuestion } : {}),
    ...(intent.clarificationOptions ? { clarificationOptions: intent.clarificationOptions } : {}),
    ...(projectContext ? { projectContext } : {}),
  }
}
