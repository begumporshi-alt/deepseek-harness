import { describe, expect, it } from 'vitest'
import type { PreStepDecision, Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { MemoryEntry } from '@deepseek-ai/dsh-memory'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import type { MemoryId } from '@deepseek-ai/dsh-memory'
import { brandString } from '@deepseek-ai/dsh-brand'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createMemoryIndexHandler, hasPublishedIndex, renderIndexLine, renderIndexMessage } from '@deepseek-ai/dsh-tool-memory'

/** Hand-built agent whose session can record model-visible messages. */
function fakeAgent(): Agent {
  const session = Session.create(SessionId('memory-section-agent'))
  return {
    id: session.id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: undefined as never,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

function entry(content: string, kind: MemoryEntry['kind'] = 'user'): MemoryEntry {
  const now = 1_700_000_000_000
  return { id: brandString<MemoryId>('mem_x'), kind, content, createdAt: now, updatedAt: now }
}

const enter: PreStepDecision = { kind: 'enter', messages: [] }

describe('memory index section', () => {
  it('detects a published index from the durable session log', () => {
    const agent = fakeAgent()
    expect(hasPublishedIndex(agent)).toBe(false)
    agent.session.append('user/message', renderIndexMessage([entry('fact')], 120), { surfaceOp: 'append' })
    expect(hasPublishedIndex(agent)).toBe(true)
  })

  it('renders one truncated first line per entry', () => {
    expect(renderIndexLine(entry('short fact'), 120)).toBe('- [user] short fact')
    expect(renderIndexLine(entry('first line\nsecond line'), 120)).toBe('- [user] first line')
    expect(renderIndexLine(entry('x'.repeat(200)), 120)).toBe(`- [user] ${'x'.repeat(120)}…`)
    expect(renderIndexLine(entry('project fact', 'project'), 120)).toBe('- [project] project fact')
  })

  it('renders the durable index message with its source', () => {
    const message = renderIndexMessage([entry('a'), entry('b', 'reference')], 120)
    expect(message.source).toEqual({ kind: 'memory-index', form: 'index', entryCount: 2 })
    const text = message.content.filter(block => block.type === 'text').map(block => block.type === 'text' ? block.text : '').join('')
    expect(text).toContain('Persistent project memory is available.')
    expect(text).toContain('- [user] a')
    expect(text).toContain('- [reference] b')
    expect(text).toContain('memory_save')
  })

  it('injects until the session records the publication, then stops', async () => {
    const memory = { list: async () => [entry('remembered fact')] }
    const handler = createMemoryIndexHandler(memory, 120)
    const agent = fakeAgent()
    const signal = new AbortController().signal

    const first = await handler({ agent, signal }, async () => enter)
    expect(first.kind).toBe('enter')
    expect(first.kind === 'enter' && first.messages).toHaveLength(1)
    const message = first.kind === 'enter' ? first.messages[0] : undefined
    expect(message?.source.kind).toBe('memory-index')

    // The handler cannot know about messages the loop has not recorded yet,
    // so it injects again until the durable log carries the publication.
    const second = await handler({ agent, signal }, async () => enter)
    expect(second.kind === 'enter' && second.messages).toHaveLength(1)

    agent.session.append('user/message', renderIndexMessage([entry('remembered fact')], 120), { surfaceOp: 'append' })
    const third = await handler({ agent, signal }, async () => enter)
    expect(third.kind === 'enter' && third.messages).toHaveLength(0)
  })

  it('passes reject decisions through without reading memory', async () => {
    const memory = { list: async () => { throw new Error('must not read') } }
    const handler = createMemoryIndexHandler(memory, 120)
    const agent = fakeAgent()
    const result = await handler({ agent, signal: new AbortController().signal }, async () => ({ kind: 'reject' as const }))
    expect(result).toEqual({ kind: 'reject' })
  })

  it('skips injection when the store has no entries', async () => {
    const memory = { list: async () => [] as MemoryEntry[] }
    const handler = createMemoryIndexHandler(memory, 120)
    const agent = fakeAgent()
    const result = await handler({ agent, signal: new AbortController().signal }, async () => enter)
    expect(result.kind === 'enter' && result.messages).toHaveLength(0)
  })

  it('degrades to no injection when no provider is registered', async () => {
    const memory = { list: async () => { throw new MemoryError('provider-missing', 'no provider') } }
    const handler = createMemoryIndexHandler(memory, 120)
    const agent = fakeAgent()
    const result = await handler({ agent, signal: new AbortController().signal }, async () => enter)
    expect(result.kind === 'enter' && result.messages).toHaveLength(0)
  })

  it('rethrows non-seam storage failures', async () => {
    const memory = { list: async () => { throw new Error('disk exploded') } }
    const handler = createMemoryIndexHandler(memory, 120)
    const agent = fakeAgent()
    await expect(handler({ agent, signal: new AbortController().signal }, async () => enter)).rejects.toThrow('disk exploded')
  })

  it('rethrows seam errors that are not provider-missing', async () => {
    const memory = { list: async () => { throw new MemoryError('duplicate-provider', 'wired twice') } }
    const handler = createMemoryIndexHandler(memory, 120)
    const agent = fakeAgent()
    await expect(handler({ agent, signal: new AbortController().signal }, async () => enter)).rejects.toThrow('wired twice')
  })
})
