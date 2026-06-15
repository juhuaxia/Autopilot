import { createHash } from "node:crypto"

const MAX_PROMPT_SUMMARY_CHARS = 8000
const MAX_BLOCK_CHARS = 1200

function truncateBlock(content: string, maxChars = MAX_BLOCK_CHARS): string {
  const normalized = content.replace(/\r\n/g, "\n").trim()
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, maxChars).trimEnd()}\n[TRUNCATED] Prompt block trimmed for storage focus.`
}

function summarizePrompt(prompt: string): string {
  const normalized = prompt.replace(/\r\n/g, "\n").trim()
  if (normalized.length <= MAX_PROMPT_SUMMARY_CHARS) {
    return normalized
  }

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)

  const selectedHead: string[] = []
  const selectedTail: string[] = []
  const budget = MAX_PROMPT_SUMMARY_CHARS - 80
  const headBudget = Math.floor(budget * 0.6)
  const tailBudget = budget - headBudget

  let usedHead = 0
  for (const block of blocks) {
    const summarizedBlock = truncateBlock(block)
    const nextLength = usedHead + summarizedBlock.length + (selectedHead.length > 0 ? 2 : 0)
    if (nextLength > headBudget) {
      break
    }
    selectedHead.push(summarizedBlock)
    usedHead = nextLength
  }

  let usedTail = 0
  for (let index = blocks.length - 1; index >= selectedHead.length; index -= 1) {
    const summarizedBlock = truncateBlock(blocks[index] ?? "")
    const nextLength = usedTail + summarizedBlock.length + (selectedTail.length > 0 ? 2 : 0)
    if (nextLength > tailBudget) {
      break
    }
    selectedTail.unshift(summarizedBlock)
    usedTail = nextLength
  }

  const selected = [...selectedHead]
  if (selectedHead.length + selectedTail.length < blocks.length) {
    selected.push("[...TRUNCATED_MIDDLE...] Prompt middle omitted for storage focus.")
  }
  selected.push(...selectedTail)

  if (selected.length === 0) {
    return `${normalized.slice(0, MAX_PROMPT_SUMMARY_CHARS).trimEnd()}\n[TRUNCATED] Prompt trimmed for storage focus.`
  }

  const summary = selected.join("\n\n")
  return summary.length < normalized.length
    ? `${summary}\n\n[TRUNCATED] Prompt summarized for storage focus.`
    : summary
}

export function buildPromptStorageSummary(prompt: string): {
  summary: string
  hash: string
  length: number
} {
  return {
    summary: summarizePrompt(prompt),
    hash: createHash("sha256").update(prompt).digest("hex").slice(0, 16),
    length: prompt.length,
  }
}
