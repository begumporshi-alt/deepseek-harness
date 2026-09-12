/**
 * Automation consumer for the model: the `automation_create` /
 * `automation_list` / `automation_delete` tools over `ctx.automation`.
 * @module @deepseek-ai/dsh-tool-automation
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerAutomationTools } from './tools.ts'

export { automationErrorValue, registerAutomationTools } from './tools.ts'

/** Cordis function-plugin name. */
export const name = 'tool-automation'

/** Services required before the tools register. */
export const inject = ['tools', 'automation']

/**
 * Register the automation tools for the lifetime of `ctx`.
 * @param ctx - Plugin context; the registration is disposed with it.
 */
export function apply(ctx: Context): void {
  registerAutomationTools(ctx, ctx.automation, () => process.cwd())
}
