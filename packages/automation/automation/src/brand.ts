/** Opaque automation identities shared by the runtime, tools, and Session provenance. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one durable automation record. */
export type AutomationId = Branded<'AutomationId'>

/**
 * Brand an automation id.
 * @param value - non-empty record identifier allocated by the runtime.
 * @returns the same string with its compile-time brand.
 */
export function AutomationId(value: string): AutomationId {
  return value as AutomationId
}
