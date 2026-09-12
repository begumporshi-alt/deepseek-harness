/**
 * One automation run: create or resume the target Session, submit the prompt
 * with automation provenance, await the driven turn, and derive the outcome
 * from the durable log.
 * @module @deepseek-ai/dsh-automation/src/run
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle, Agent } from '@deepseek-ai/dsh-agent'
// Type-only: resolves ctx.agents for the create/resume/reuse paths.
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: resolves ctx.agentDefaultModel for the run-time model route.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { brandString } from '@deepseek-ai/dsh-brand'
import { boundContextSummary, createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: resolves ctx.sessions for the post-run durability barrier.
import type {} from '@deepseek-ai/dsh-session'
import type { AutomationRecord, AutomationRunSummary } from './types.ts'

/** Cap on the durable failure detail one run records. */
const RUN_DETAIL_MAX_CHARS = 200

/** Bound one failure detail for durable storage. */
function boundDetail(detail: string): string {
  return detail.length <= RUN_DETAIL_MAX_CHARS ? detail : `${detail.slice(0, RUN_DETAIL_MAX_CHARS - 1)}…`
}

/**
 * Derive the run outcome from the driven turn's durable events.
 * @param session - the session the prompt was submitted to.
 * @param firstSeq - log offset recorded just before submission.
 * @param startedAt - run start in epoch milliseconds.
 * @returns the settled run summary.
 */
function summarizeRun(session: Session, firstSeq: number, startedAt: number): AutomationRunSummary {
  const finishedAt = Date.now()
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  const length = session.seq
  for (let seq = firstSeq; seq < length; seq++) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = session.eventAt(SessionSeq(seq))
    if (event?.type === 'turn/end') reason = event.data.reason
  }
  if (reason === undefined) {
    return { startedAt, finishedAt, outcome: 'error', detail: 'no turn outcome was recorded' }
  }
  if (reason.kind === 'completed') return { startedAt, finishedAt, outcome: 'completed' }
  const failure = reason.kind === 'error' ? `: ${errorChain(reason.error)}` : ''
  return { startedAt, finishedAt, outcome: 'error', detail: boundDetail(`turn ended with ${reason.kind}${failure}`) }
}

/** One settled failure summary. */
function errorRun(startedAt: number, error: unknown): AutomationRunSummary {
  return { startedAt, finishedAt: Date.now(), outcome: 'error', detail: boundDetail(error instanceof Error ? error.message : String(error)) }
}

/**
 * Execute one due automation run end to end. The run owns any Agent it
 * creates or resumes and disposes it after the durability barrier; a live
 * target Agent is reused in place and left running.
 * @param ctx - untraced runtime context that owns created or resumed Agents.
 * @param record - the automation being run.
 * @param signal - runtime-lifetime cancellation.
 * @returns the settled run summary; the caller persists it.
 */
export async function executeAutomationRun(
  ctx: Context,
  record: AutomationRecord,
  signal: AbortSignal,
): Promise<AutomationRunSummary> {
  const startedAt = Date.now()
  let handle: AgentHandle | undefined
  try {
    signal.throwIfAborted()
    // Resolve the route at run start: a record without an explicit model
    // follows the current default selection instead of a creation-time snapshot.
    const selection = ctx.agentDefaultModel.currentSelection()
    const agentOptions = record.model === undefined
      ? { provider: selection.provider, model: selection.model }
      : {
        provider: record.model.provider,
        model: record.model.model,
        ...(record.model.maxTokens === undefined ? {} : { maxTokens: record.model.maxTokens }),
      }
    let agent: Agent
    if (record.action.kind === 'new-session') {
      handle = await ctx.agents.create({
        sessionId: brandString<SessionId>(`automation-${randomUUID()}`),
        meta: { cwd: record.action.cwd },
        agentOptions,
        signal,
      })
      agent = handle.agent
    } else {
      const live = ctx.agents.get(SessionId(record.action.sessionId))
      if (live !== undefined) {
        agent = live
      } else {
        handle = await ctx.agents.resume({
          resumeSessionId: SessionId(record.action.sessionId),
          agentOptions,
          signal,
        })
        agent = handle.agent
      }
    }
    await agent.whenIdle()
    signal.throwIfAborted()
    const firstSeq = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: record.prompt }],
      source: {
        kind: 'automation',
        automationId: record.id,
        form: 'notice',
        summary: boundContextSummary(`automation ${record.title} (${record.id})`),
      },
    }))
    await agent.whenIdle()
    await ctx.sessions.flush(agent.session)
    return summarizeRun(agent.session, firstSeq, startedAt)
  } catch (error: unknown) {
    if (signal.aborted) throw error
    return errorRun(startedAt, error)
  } finally {
    if (handle !== undefined) {
      try {
        await handle.dispose()
      } catch (disposeError: unknown) {
        ctx.logger.warn(`automation ${record.id}: run cleanup failed: ${errorChain(disposeError)}`)
      }
    }
  }
}
