export type QuestionPriority = "required" | "recommended" | "optional"

export interface Question {
  id: string
  priority: QuestionPriority
  text: string
  canAutoResolve: boolean
  suggestedAnswer?: string
}
