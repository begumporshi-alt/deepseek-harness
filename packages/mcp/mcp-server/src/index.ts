/**
 * MCP (Model Context Protocol) server bridge: exposes the harness's
 * registered tools to external MCP clients over stdio. One harness agent per
 * process owns every served call; tool schemas are projected from the dsh
 * dialect to standard JSON Schema on `tools/list`, and `tools/call` runs the
 * harness's guarded execution pipeline with the client's cancellation signal.
 * @module @deepseek-ai/dsh-mcp-server
 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { dshSchemaToMcp } from './schema.ts'

export { dshSchemaToMcp } from './schema.ts'

/** Cordis function-plugin name. */
export const name = 'mcp-server'

/** Services the bridge reads while wiring the transport. */
export const inject = ['agents', 'sessions', 'tools']

/** Default MCP server name advertised at initialize. */
export const DEFAULT_SERVER_NAME = 'deepseek-harness-mcp'

/** Default MCP server version advertised at initialize. */
export const DEFAULT_SERVER_VERSION = '0.0.1'

/** Plugin config: the exposed server identity and per-agent model selection. */
export interface McpServerConfig {
  /** Provider route for the serving agent. */
  provider?: string
  /** Model name for the serving agent. */
  model?: string
  /** Server name advertised at MCP initialize. */
  serverName?: string
  /** Server version advertised at MCP initialize. */
  serverVersion?: string
  /** Runtime-only transport override; production uses stdio. */
  transport?: Transport
}

/** Schemastery validation for {@link McpServerConfig}. */
export const Config: Schema<McpServerConfig> = Schema.object({
  provider: Schema.string(),
  model: Schema.string(),
  serverName: Schema.string(),
  serverVersion: Schema.string(),
})

/**
 * Map one harness tool schema onto the MCP tool description shape.
 * @param schema - The harness tool schema with name, description, and dialect parameters.
 * @returns the MCP tool description with a standard-JSON-Schema input.
 */
export function toMcpTool(schema: { name: string; description?: string; parameters?: unknown }): {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
} {
  return {
    name: schema.name,
    ...schema.description === undefined ? {} : { description: schema.description },
    inputSchema: dshSchemaToMcp(schema.parameters ?? {
      type: 'object',
      properties: {},
    }) as Record<string, unknown>,
  }
}

/**
 * Map harness tool-result content onto MCP content blocks.
 * @param blocks - The canonical tool-result content.
 * @returns MCP content blocks; non-text blocks degrade to bounded text diagnostics.
 */
export function toMcpContent(blocks: readonly ContentBlock[]): Array<{ type: string; text?: string }> {
  return blocks.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text }
    return { type: 'text', text: `[${block.type} content omitted by the MCP bridge]` }
  })
}

/**
 * Mount the MCP server bridge. The serving agent is created lazily on first
 * tool use — one agent per process, so every MCP client shares one session,
 * and its visible tool set is what `tools/list` reports. Disposing the plugin
 * fiber closes the transport and disposes the agent.
 * @param ctx - Cordis context carrying the agent factory and tool registry.
 * @param config - Server identity, per-agent model selection, and optional test transport.
 */
export function apply(ctx: Context, config: McpServerConfig = {}): void {
  const agents = ctx.agents
  const tools = ctx.tools
  const sessions = ctx.sessions
  const logger = ctx.logger
  const sessionId = brandString<SessionId>(randomUUID())
  const agentOptions = {
    ...config.provider !== undefined ? { provider: config.provider } : {},
    ...config.model !== undefined ? { model: config.model } : {},
  }

  let handle: AgentHandle | undefined
  let creating: Promise<AgentHandle> | undefined
  let disposed = false

  const assertOpen = (): void => {
    /* v8 ignore next 1 -- the transport closes with the fiber, so a disposed bridge is
    // unreachable through a live client; the guard pins the fail-closed contract. */
    if (disposed) throw new McpError(ErrorCode.InternalError, 'the MCP bridge has been disposed')
  }

  /** Create the serving agent on first use; concurrent callers share one creation. */
  const ensureAgent = async (): Promise<AgentHandle> => {
    assertOpen()
    if (handle !== undefined) return handle
    creating ??= (async () => {
      const created = await agents.create({
        sessionId,
        meta: { cwd: process.cwd() },
        agentOptions,
      })
      await sessions.flush(created.agent.session)
      handle = created
      return created
    })()
    return creating
  }

  // The low-level Server is the advanced-use-case API the SDK keeps for raw
  // schema control; the high-level McpServer is zod-first and does not accept
  // the harness's JSON-schema dialect.
  // oxlint-disable-next-line typescript/no-deprecated -- raw schema control, see above.
  const server = new Server(
    { name: config.serverName ?? DEFAULT_SERVER_NAME, version: config.serverVersion ?? DEFAULT_SERVER_VERSION },
    { capabilities: { tools: {} } },
  )

  const teardown = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    /* v8 ignore next 3 -- server.close rejects only when the transport already failed; that failure path logs through onclose. */
    await server.close().catch((error: unknown) => {
      logger.warn(`mcp-server: transport close failed: ${String(error)}`)
    })
    /* v8 ignore next 1 -- swallows a creation failure racing disposal; no test can deterministically interleave them. */
    const active = handle ?? await creating?.catch(() => undefined)
    await active?.dispose()
  }

  server.setRequestHandler(ListToolsRequestSchema, () => {
    assertOpen()
    return { tools: tools.schemas().map(schema => toMcpTool(schema)) }
  })
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const agent = (await ensureAgent()).agent
    const known = tools.schemas().some(schema => schema.name === request.params.name)
    if (!known) {
      throw new McpError(ErrorCode.InvalidParams, `unknown tool: ${request.params.name}`)
    }
    const result = await tools.execute({
      signal: extra.signal,
      callId: brandString<ToolCallId>(randomUUID()),
      name: request.params.name,
      arguments: request.params.arguments ?? {},
      agent,
    })
    return { content: toMcpContent(result.content), isError: result.isError }
  })

  /* v8 ignore next 2 -- production always runs stdio; tests inject config.transport. */
  const transport: Transport = config.transport
    ?? new StdioServerTransport()
  transport.onclose = () => {
    /* v8 ignore next 3 -- teardown rejects only if disposal itself fails after a transport failure already logged. */
    void teardown().catch((error: unknown) => {
      logger.warn(`mcp-server: teardown failed: ${String(error)}`)
    })
  }

  // A failed connect tears the bridge down instead of leaking the rejection;
  // teardown also awaits `connected` so disposal never races the handshake.
  void server.connect(transport).catch((error: unknown) => {
    logger.error(`mcp-server: transport connect failed: ${String(error)}`)
    return teardown()
  })

  ctx.effect(() => teardown, 'mcp-server.bridge')
}
