/**
 * Automation capability seam (`ctx.automation`): durable application-scoped
 * schedules that create or resume Sessions when due.
 * @module @deepseek-ai/dsh-automation
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
// Type-only: resolves ctx.agents for run dispatch and initiator scoping.
import type {} from '@deepseek-ai/dsh-agent'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: resolves ctx.sessions and ctx.sessionPersistence.
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import z from '@deepseek-ai/schemastery'
import { AutomationId } from './brand.ts'
import {
  applyRunOutcome,
  createAutomationRecord,
  AutomationInputError,
  MAX_TIMER_DELAY_MS,
  nextDueAt,
} from './domain.ts'
import { executeAutomationRun } from './run.ts'
import { AutomationFileStore } from './store.ts'
import type { AutomationCreateInput, AutomationRecord } from './types.ts'

export { AutomationId }
export type {
  AutomationAction,
  AutomationCreateInput,
  AutomationModelSelection,
  AutomationRecord,
  AutomationRunSummary,
  AutomationTrigger,
  AutomationTriggerInput,
} from './types.ts'
export {
  applyRunOutcome,
  AutomationInputError,
  createAutomationRecord,
  cronNextAt,
  decodeAutomationRecord,
  MAX_TIMER_DELAY_MS,
  MIN_TRIGGER_INTERVAL_SECONDS,
  nextDueAt,
} from './domain.ts'
export { AutomationFileStore, readAutomationStore, STORE_FORMAT_VERSION, writeAutomationStore } from './store.ts'
export type { AutomationStoreFile } from './store.ts'
export { executeAutomationRun } from './run.ts'

/** Default store location under the dsh home directory.
 * @returns the absolute default store path.
 */
export function defaultAutomationStorePath(): string {
  return dshHomePath('automations', 'automations.json')
}

/** Runtime configuration. Invalid values fail service load. */
export interface Config {
  /**
   * Absolute path of the durable store file. Defaults to
   * `<dsh home>/automations/automations.json`.
   */
  storePath?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    automation: AutomationRuntime
  }
}

/**
 * The automation runtime: a durable record set, a single-flight due driver
 * over segmented timers, and the public create/list/delete surface. Every
 * mutation persists the complete state before the next due instant is armed.
 */
export class AutomationRuntime extends Service {
  static inject = ['agents', 'agentDefaultModel', 'sessions', 'sessionPersistence']
  static Config: z<Config> = z.object({
    storePath: z.string(),
  })

  private readonly records = new Map<AutomationId, AutomationRecord>()
  private readonly store: AutomationFileStore
  private readonly stopController = new AbortController()
  private readonly activeRuns = new Set<Promise<void>>()
  private readonly ready: Promise<void>
  private timer: NodeJS.Timeout | null = null
  private driving = false
  private wakePending = false
  private stopped = false

  /**
   * Construct the runtime and begin loading the durable store.
   * @param ctx - context that owns the runtime's registrations.
   * @param config - store location configuration.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'automation')
    this.store = new AutomationFileStore(config.storePath ?? defaultAutomationStorePath())
    this.ready = this.boot()
    ctx.effect(() => () => {
      void this.stop()
    }, 'automation.lifecycle()')
  }

  /** Load the durable records and arm the first due wait. */
  private async boot(): Promise<void> {
    for (const record of await this.store.load()) {
      this.records.set(record.id, record)
    }
    this.arm()
  }

  /**
   * Create one automation.
   * @param input - validated creation input; a `resume-session` action must
   * name a persisted Session.
   * @returns the stored record.
   * @throws {@link AutomationInputError} for invalid input.
   */
  async create(input: AutomationCreateInput): Promise<AutomationRecord> {
    await this.ready
    if (this.stopped) throw new Error('automation runtime is stopping')
    if (input.action.kind === 'resume-session') {
      const stat = await this.ctx.sessionPersistence.stat(SessionId(input.action.sessionId))
      if (stat === undefined) {
        throw new AutomationInputError(`action.sessionId does not exist in the persistence root: ${JSON.stringify(input.action.sessionId)}`)
      }
    }
    const record = createAutomationRecord(input, AutomationId(`automation-${randomUUID()}`), Date.now())
    this.records.set(record.id, record)
    await this.persist()
    this.arm()
    return record
  }

  /**
   * List every stored record.
   * @returns the records in creation order.
   */
  async list(): Promise<readonly AutomationRecord[]> {
    await this.ready
    return [...this.records.values()]
  }

  /**
   * Delete one stored record.
   * @param id - the automation to remove.
   * @returns whether a record was removed; `false` for an unknown id.
   */
  async delete(id: AutomationId): Promise<boolean> {
    await this.ready
    if (this.stopped) throw new Error('automation runtime is stopping')
    const deleted = this.records.delete(id)
    if (deleted) {
      await this.persist()
      this.arm()
    }
    return deleted
  }

  /** Persist the complete record set through the serialized store save. */
  private persist(): Promise<void> {
    return this.store.persist([...this.records.values()])
  }

  /** Arm one segmented timer at the earliest next due instant. */
  private arm(): void {
    if (this.stopped) return
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    let earliest: number | null = null
    for (const record of this.records.values()) {
      const due = nextDueAt(record)
      if (due !== null && (earliest === null || due < earliest)) earliest = due
    }
    if (earliest === null) return
    const delay = Math.min(Math.max(earliest - Date.now(), 0), MAX_TIMER_DELAY_MS)
    this.timer = setTimeout(() => {
      void this.wake()
    }, delay)
  }

  /**
   * Claim one deferred wake, if any. Reading through a method keeps the
   * compiler from narrowing the flag to its last synchronous assignment.
   */
  private consumeWakePending(): boolean {
    const pending = this.wakePending
    this.wakePending = false
    return pending
  }

  /**
   * Run every due record once, single-flight. A wake arriving while a pass is
   * driving defers to one more pass after it settles.
   */
  private async wake(): Promise<void> {
    if (this.driving) {
      this.wakePending = true
      return
    }
    this.driving = true
    try {
      do {
        const now = Date.now()
        for (const record of [...this.records.values()]) {
          if (this.stopped) return
          const due = nextDueAt(record)
          if (due === null || due > now) continue
          await this.runOne(record)
        }
      } while (this.consumeWakePending())
    } finally {
      this.driving = false
    }
    this.arm()
  }

  /**
   * Execute one run and record its outcome. An aborted run (runtime stop)
   * records nothing so the next boot re-derives it.
   */
  private runOne(record: AutomationRecord): Promise<void> {
    const tracked = (async () => {
      const run = await this.ctx.agents.withoutInitiator(
        () => executeAutomationRun(this.ctx, record, this.stopController.signal),
      )
      if (this.records.get(record.id) !== record) return
      this.records.set(record.id, applyRunOutcome(record, run))
      await this.persist()
    })().catch((error: unknown) => {
      const subject = `automation ${record.id}`
      if (this.stopController.signal.aborted) {
        this.ctx.logger.debug(`${subject} stopped after shutdown: ${errorChain(error)}`)
      } else {
        this.ctx.logger.warn(`${subject} failed: ${errorChain(error)}`)
      }
    }).finally(() => {
      this.activeRuns.delete(tracked)
    })
    this.activeRuns.add(tracked)
    return tracked
  }

  /** Stop the driver, abort in-flight runs, and drain them. */
  private async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.stopController.abort(new Error('automation runtime stopped'))
    await Promise.allSettled([...this.activeRuns])
  }
}

// Service packages default-export their service class and nothing else
// plugin-shaped (packages/AGENTS.md): mixing a default export with a
// function-plugin `apply` makes the Loader drop the plugin namespace.
export default AutomationRuntime
