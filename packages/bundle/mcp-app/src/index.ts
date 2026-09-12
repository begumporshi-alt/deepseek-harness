/**
 * The MCP profile's command-line and stdin-lifetime provider. A successful
 * parse publishes {@link MCP_APP_STARTUP_SERVICE}; the MCP bridge waits for
 * that service, so help starts no transport.
 * @module @deepseek-ai/dsh-mcp-app
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { exitOnStdinEnd, parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'mcp-app-startup'

/** Launcher service required before this app can parse its invocation. */
export const inject = ['cmdlineArgs']

/** Service the MCP bridge row waits for before claiming stdio. */
export const MCP_APP_STARTUP_SERVICE = 'mcpAppStartup'

/**
 * Build this app's zero-option command and help.
 * @returns a fresh program for one invocation.
 */
function mcpCommand(): Command {
  return new Command()
    .name('dsh --profile mcp')
    .description('Serve the harness tools to MCP clients over stdio.')
    .helpOption('-h, --help', 'show this help')
    .addHelpText('after', `
Example:
  dsh --profile mcp     serve MCP until the client disconnects
`)
}

/**
 * Accept an MCP profile invocation, publish readiness, and bind EOF to the
 * launcher's bounded shutdown.
 * @param ctx - plugin context carrying command-line and exit launcher values.
 */
export function apply(ctx: Context): void {
  const program = mcpCommand()
  program.action(() => {
    exitOnStdinEnd(ctx, 'mcp-app.stdin')
    ctx.provide(MCP_APP_STARTUP_SERVICE, { accepted: true })
  })
  parseCmdline(ctx, program)
}
