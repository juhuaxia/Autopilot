export type ReviewSidecarEntry = {
  reviewerSessionId: string
  roleName: string
  prompt: string
  promptHash?: string
  promptLength?: number
  status: "pending" | "running" | "idle" | "failed" | "completed"
  startedAt: string
  updatedAt: string
  lastSummary?: string | null
  issueSeverity?: "blocker" | "critical" | "high" | "medium" | "low" | "info" | null
  issueConfidence?: "high" | "medium" | "low" | null
  issueSource?: string | null
  lastError?: string
  lastSummaryHash?: string | null
}

export type ReviewSidecarFile = {
  workflowId: string
  presetMode?: string | null
  mergeMode?: string | null
  completedAt?: string | null
  readyToConsolidate?: boolean
  entries: ReviewSidecarEntry[]
  updatedAt: string
}
