import type { RecoveryClassifier, RecoveryDisposition } from "./recovery-classifier"

export class BasicRecoveryClassifier implements RecoveryClassifier {
  classify(error: unknown): RecoveryDisposition {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
    if (message.includes("timeout") || message.includes("temporary")) {
      return "retryable"
    }
    if (message.includes("missing") || message.includes("stale")) {
      return "recoverable"
    }
    return "terminal"
  }
}
