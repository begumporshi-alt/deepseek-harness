/**
 * Durable source type and renderer for the session-start memory index
 * section. The index is published once per session; later changes surface
 * through the memory tools' own results.
 * @module @deepseek-ai/dsh-tool-memory/src/section
 */

import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import type { MemoryEntry } from '@deepseek-ai/dsh-memory'

/** Durable source marking one memory-index publication. */
export interface MemoryIndexSource {
  readonly kind: 'memory-index'
  readonly form: 'index'
  /** Number of entries the published index listed. */
  readonly entryCount: number
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'memory-index': MemoryIndexSource
  }
}

/**
 * Detect whether this agent's session already carries a published memory
 * index. The session log is the dedupe authority, so resumes and forks never
 * re-publish.
 * @param agent - The agent whose session history is scanned.
 * @returns `true` when a memory-index message exists in the session log.
 */
export function hasPublishedIndex(agent: Agent): boolean {
  for (let seq = agent.session.seq - 1; seq >= 0; seq -= 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = agent.session.eventAt(SessionSeq(seq))
    /* v8 ignore next 1 -- eventAt never returns undefined for a recorded seq; the chain only satisfies the nullable read type */
    if (event?.type === 'user/message' && event.data.source.kind === 'memory-index') return true
  }
  return false
}

/**
 * Render one index line: the entry kind, then the entry's first line,
 * truncated to `maxChars` characters.
 * @param entry - The entry to summarize.
 * @param maxChars - Maximum characters of content shown per line.
 * @returns one `- [kind] content` line.
 */
export function renderIndexLine(entry: MemoryEntry, maxChars: number): string {
  const firstNewline = entry.content.indexOf('\n')
  const firstLine = firstNewline === -1 ? entry.content : entry.content.slice(0, firstNewline)
  const truncated = firstLine.length > maxChars ? `${firstLine.slice(0, maxChars)}…` : firstLine
  return `- [${entry.kind}] ${truncated}`
}

/**
 * Build the durable memory-index message for one set of entries.
 * @param entries - The entries to list, in provider order.
 * @param maxChars - Maximum characters of content shown per line.
 * @returns the user message carrying the index section.
 */
export function renderIndexMessage(entries: readonly MemoryEntry[], maxChars: number): UserMessage {
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        'Persistent project memory is available. Facts remembered from earlier sessions:',
        '',
        ...entries.map(entry => renderIndexLine(entry, maxChars)),
        '',
        'Record facts worth carrying into future sessions with `memory_save`. Check `memory_search` or `memory_list` before asking the user for information that may already be remembered.',
        '</system-reminder>',
      ].join('\n'),
    }],
    source: { kind: 'memory-index', form: 'index', entryCount: entries.length },
  })
}

/**
 * Build the `agent/pre-step` handler that publishes the memory index once
 * per session. A missing provider degrades to no injection — the tools
 * surface the wiring failure; the section never breaks the step. Exported
 * for direct testing; registration is a bare listener.
 * @param memory - The memory service to read entries from.
 * @param maxChars - Maximum characters of content shown per index line.
 * @returns the waterfall handler.
 */
export function createMemoryIndexHandler(
  memory: { list(): Promise<readonly MemoryEntry[]> },
  maxChars: number,
): (payload: { agent: Agent; signal: AbortSignal }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision> {
  return async (
    { agent, signal }: { agent: Agent; signal: AbortSignal },
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    signal.throwIfAborted()
    if (hasPublishedIndex(agent)) return decision
    let entries: readonly MemoryEntry[]
    try {
      entries = await memory.list()
    } catch (error: unknown) {
      if (error instanceof MemoryError && error.code === 'provider-missing') return decision
      throw error
    }
    if (entries.length === 0) return decision
    return {
      ...decision,
      messages: [...decision.messages, renderIndexMessage(entries, maxChars)],
    }
  }
}
