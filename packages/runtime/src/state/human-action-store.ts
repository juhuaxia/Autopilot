import type { HumanAction } from "../../../core/src/human-actions/human-action"
import type { HumanActionRecord } from "../../../core/src/human-actions/human-action-record"

export interface HumanActionStore {
  create(action: HumanAction): Promise<HumanActionRecord>
  getCurrent(workflowId: string): Promise<HumanActionRecord | null>
  markPresented(actionId: string): Promise<void>
  markResponded(actionId: string): Promise<void>
  markConsumed(actionId: string): Promise<void>
}
