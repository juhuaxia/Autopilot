export type RecoveryDisposition =
  | "retryable"
  | "recoverable"
  | "terminal"

export interface RecoveryClassifier {
  classify(error: unknown): RecoveryDisposition
}
