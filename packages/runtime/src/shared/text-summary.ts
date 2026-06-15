export function truncateInlineText(value: string, maxChars: number, note?: string): string {
  const normalized = value.replace(/\r\n/g, "\n").trim()
  if (normalized.length <= maxChars) {
    return normalized
  }
  const suffix = note ? `\n${note}` : ""
  return `${normalized.slice(0, maxChars).trimEnd()}${suffix}`
}

export function summarizeMarkdownContent(content: string, maxChars: number): string {
  const normalized = content.replace(/\r\n/g, "\n").trim()
  if (normalized.length <= maxChars) {
    return normalized
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)

  const selected: string[] = []
  let used = 0
  for (const line of lines) {
    const isSignal = /^#{1,6}\s/.test(line) || /^[-*]\s/.test(line) || /^\d+\.\s/.test(line)
    const candidate = isSignal ? line : truncateInlineText(line, Math.min(240, maxChars))
    const nextLength = used + candidate.length + (selected.length > 0 ? 1 : 0)
    if (nextLength > maxChars) {
      break
    }
    selected.push(candidate)
    used = nextLength
  }

  if (selected.length === 0) {
    return truncateInlineText(normalized, maxChars, "\n[TRUNCATED] Summary trimmed for prompt focus.")
  }

  const summary = selected.join("\n")
  return summary.length < normalized.length
    ? `${summary}\n[TRUNCATED] Summary trimmed for prompt focus.`
    : summary
}
