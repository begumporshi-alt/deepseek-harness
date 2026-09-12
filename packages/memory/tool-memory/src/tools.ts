/**
 * Model-facing memory tools over `ctx.memory`: save, search, list, and
 * forget. Errors surface as schema'd error values, never as thrown tool
 * failures, so the model can correct its own input.
 * @module @deepseek-ai/dsh-tool-memory/src/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import type { Memory, MemoryEntry, MemoryId, MemoryKind } from '@deepseek-ai/dsh-memory'
import { basicErrorSchema, defineTool } from '@deepseek-ai/dsh-tools'

/** JSON-schema view of one memory entry; timestamps render as ISO 8601 strings. */
const ENTRY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['user', 'feedback', 'project', 'reference'] },
    content: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
  },
} as const

/** JSON-schema view of the saved-entry value. */
const SAVE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entry: ENTRY_SCHEMA,
  },
} as const

/** JSON-schema view of the list/search value. */
const ENTRIES_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entries: { type: 'array', required: true, items: ENTRY_SCHEMA },
  },
} as const

/** JSON-schema view of the forget value. */
const FORGET_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    deleted: { type: 'boolean', required: true },
  },
} as const

/** Every tool-callable failure, schema'd for the model. */
const ERROR_SCHEMAS = [
  basicErrorSchema('invalid_content'),
  basicErrorSchema('content_too_large'),
  basicErrorSchema('provider_unavailable'),
  basicErrorSchema('internal_error'),
] as const

const SAVE_OUTPUT = { oneOf: [SAVE_OUTPUT_SCHEMA, ...ERROR_SCHEMAS] } as const
const ENTRIES_OUTPUT = { oneOf: [ENTRIES_OUTPUT_SCHEMA, ...ERROR_SCHEMAS] } as const
const FORGET_OUTPUT = { oneOf: [FORGET_OUTPUT_SCHEMA, ...ERROR_SCHEMAS] } as const

/** Model-facing description of `memory_save`. */
const SAVE_DESCRIPTION = 'Record one durable fact for future sessions. Use it for stable user preferences, feedback, project constraints, or reference pointers — not for session working state.'

/** Model-facing description of `memory_search`. */
const SEARCH_DESCRIPTION = 'Search remembered facts by case-insensitive substring match against entry content.'

/** Model-facing description of `memory_list`. */
const LIST_DESCRIPTION = 'List remembered facts for this project, newest first.'

/** Model-facing description of `memory_forget`. */
const FORGET_DESCRIPTION = 'Delete one remembered fact by its id.'

/** ISO-string tool view of one entry. */
interface EntryView {
  readonly id: string
  readonly kind: MemoryKind
  readonly content: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Convert one epoch-millisecond entry into the ISO-string tool view. */
function entryView(entry: MemoryEntry): EntryView {
  return {
    id: entry.id,
    kind: entry.kind,
    content: entry.content,
    createdAt: new Date(entry.createdAt).toISOString(),
    updatedAt: new Date(entry.updatedAt).toISOString(),
  }
}

/** Deterministic model content for every canonical memory value. */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  // The ToolRuntime has already validated the value against the lossless-JSON output schema.
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Schema'd error value the memory tools return instead of throwing. */
type MemoryErrorValue = {
  readonly code: 'invalid_content' | 'content_too_large' | 'provider_unavailable' | 'internal_error'
  readonly message: string
}

/**
 * Map a rejected memory operation onto the schema'd error vocabulary.
 * Provider wiring and storage failures surface as `provider_unavailable` so
 * the model knows retrying cannot fix them; input errors keep their codes.
 * @param error - The rejection from the memory service or its provider.
 * @returns the schema'd error value.
 */
export function memoryErrorValue(error: unknown): MemoryErrorValue {
  if (error instanceof MemoryError) {
    switch (error.code) {
      case 'invalid-content': return { code: 'invalid_content', message: error.message }
      case 'content-too-large': return { code: 'content_too_large', message: error.message }
      case 'provider-missing': return { code: 'provider_unavailable', message: 'no memory provider is loaded; memory tools are unavailable in this composition' }
      case 'duplicate-provider': break
    }
  }
  return { code: 'internal_error', message: error instanceof Error ? error.message : String(error) }
}

/**
 * Register the four memory tools on the tool registry for the calling
 * fiber's lifetime; the registry disposes them with it.
 * @param ctx - Plugin context holding the tool registry.
 * @param memory - The memory service the tools operate on.
 */
export function registerMemoryTools(ctx: Context, memory: Memory): void {
  ctx.tools.register(defineTool({
    name: 'memory_save',
    description: SAVE_DESCRIPTION,
    parameters: {
      kind: {
        type: 'string',
        required: true,
        enum: ['user', 'feedback', 'project', 'reference'],
        description: 'What kind of knowledge this is: `user` (who the user is), `feedback` (corrections and confirmed approaches), `project` (goals, constraints, decisions), or `reference` (pointers to external resources).',
      },
      content: {
        type: 'string',
        required: true,
        description: 'The fact to remember, as self-contained prose a later session can use without this conversation.',
      },
    },
    output: { schema: SAVE_OUTPUT, render: renderValue },
    async execute(args) {
      try {
        const entry = await memory.record({ kind: args.kind, content: args.content })
        return { entry: entryView(entry) }
      } catch (error: unknown) {
        return memoryErrorValue(error)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_search',
    description: SEARCH_DESCRIPTION,
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Case-insensitive text to match against entry content.',
      },
    },
    output: { schema: ENTRIES_OUTPUT, render: renderValue },
    async execute(args) {
      try {
        const entries = await memory.search(args.query)
        return { entries: entries.map(entryView) }
      } catch (error: unknown) {
        return memoryErrorValue(error)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_list',
    description: LIST_DESCRIPTION,
    parameters: {},
    output: { schema: ENTRIES_OUTPUT, render: renderValue },
    async execute() {
      try {
        const entries = await memory.list()
        return { entries: entries.map(entryView) }
      } catch (error: unknown) {
        return memoryErrorValue(error)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_forget',
    description: FORGET_DESCRIPTION,
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'The id of the entry to delete, as returned by memory_save, memory_search, or memory_list.',
      },
    },
    output: { schema: FORGET_OUTPUT, render: renderValue },
    async execute(args) {
      try {
        const deleted = await memory.forget(brandString<MemoryId>(args.id))
        return { id: args.id, deleted }
      } catch (error: unknown) {
        return memoryErrorValue(error)
      }
    },
  }))
}
