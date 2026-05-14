import { readFile } from "node:fs/promises"

export type ImageSummaryResult = {
  ok: boolean
  summary: string
  error?: string
}

export interface ImageSummaryService {
  summarize(imagePath: string): Promise<ImageSummaryResult>
}

export class NoopImageSummaryService implements ImageSummaryService {
  async summarize(_imagePath: string): Promise<ImageSummaryResult> {
    return {
      ok: false,
      summary: "",
      error: "image understanding unavailable in current environment",
    }
  }
}

type VisionModelImageSummaryServiceOptions = {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs?: number
}

export class VisionModelImageSummaryService implements ImageSummaryService {
  constructor(private readonly options: VisionModelImageSummaryServiceOptions) {}

  async summarize(imagePath: string): Promise<ImageSummaryResult> {
    const timeoutMs = this.options.timeoutMs ?? 300_000
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const imageBytes = await readFile(imagePath)
      const base64Image = imageBytes.toString("base64")
      const imageMimeType = inferImageMimeType(imagePath)
      if (!imageMimeType) {
        return {
          ok: false,
          summary: "",
          error: `unsupported image type: ${imagePath}`,
        }
      }

      const response = await fetch(normalizeChatCompletionsUrl(this.options.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            {
              role: "system",
              content: "You summarize requirement screenshots for software planning. Extract only requirement-relevant visible content. Use this exact structure: - Main area: ...\n- Visible text: ...\n- Key numbers / labels: ...\n- Actions / buttons: ...\n- Checklist / table items: ...\n- Notes / ambiguity: ... Keep it concise and do not invent unreadable details.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Summarize this image for workflow refinement/planning.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${imageMimeType};base64,${base64Image}`,
                  },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        return {
          ok: false,
          summary: "",
          error: `image summary request failed: ${response.status}`,
        }
      }

      const parsed = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string | Array<{ type?: string; text?: string }>
          }
        }>
      }
      const content = parsed.choices?.[0]?.message?.content
      const summary = extractSummaryContent(content)
      if (!summary) {
        return {
          ok: false,
          summary: "",
          error: "image summary response did not include usable text",
        }
      }

      return {
        ok: true,
        summary,
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          ok: false,
          summary: "",
          error: "image summary request timed out",
        }
      }
      return {
        ok: false,
        summary: "",
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

function normalizeChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "")
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`
}

function inferImageMimeType(imagePath: string): string | null {
  const lower = imagePath.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  return null
}

function extractSummaryContent(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content.trim()
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => item.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n")
      .trim()
  }
  return ""
}
