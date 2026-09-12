/** Durable automation records, triggers, actions, and run outcomes. */

import type { AutomationId } from './brand.ts'

/** Optional explicit model route and output cap for an automation-driven Agent. */
export interface AutomationModelSelection {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Optional positive output-token cap. */
  readonly maxTokens?: number
}

/** One scheduled occurrence rule. Exactly one trigger kind is active per record. */
export type AutomationTrigger =
  | {
    /** Fires once at the stored instant; catch-up delivers an un-run past instant on load. */
    readonly kind: 'once'
    /** Unix epoch milliseconds. */
    readonly at: number
  }
  | {
    /** Anchor-aligned fixed rate; missed occurrences advance without a catch-up burst. */
    readonly kind: 'every'
    /** Unix epoch milliseconds of the anchor occurrence. */
    readonly anchorAt: number
    /** Whole seconds between occurrences; at least MIN_TRIGGER_INTERVAL_SECONDS. */
    readonly intervalSeconds: number
  }
  | {
    /** Cron expression evaluated in the configured time zone. */
    readonly kind: 'cron'
    /** Five- or six-field cron expression. */
    readonly expression: string
    /** IANA time zone; the process zone when omitted. */
    readonly timeZone?: string
  }

/** What one due occurrence does. Exactly one action kind is active per record. */
export type AutomationAction =
  | {
    /** Creates a fresh root Session, submits the prompt, and awaits its turn. */
    readonly kind: 'new-session'
    /** Absolute working directory for the created Session. */
    readonly cwd: string
  }
  | {
    /** Submits the prompt into one existing Session, resuming it when cold. */
    readonly kind: 'resume-session'
    /** Target Session id; must exist in the configured persistence root. */
    readonly sessionId: string
  }

/** Outcome summary of one completed automation run. */
export interface AutomationRunSummary {
  /** Unix epoch milliseconds when the run started. */
  readonly startedAt: number
  /** Unix epoch milliseconds when the run settled. */
  readonly finishedAt: number
  /** `completed` when the driven turn ended normally, `error` otherwise. */
  readonly outcome: 'completed' | 'error'
  /** Bounded failure detail; present only for the `error` outcome. */
  readonly detail?: string
}

/** One durable automation: a trigger, an action, and the latest run. */
export interface AutomationRecord {
  /** Allocated by the runtime; stable across restarts. */
  readonly id: AutomationId
  /** Diagnostic label shown by tools and logs. */
  readonly title: string
  /** Unix epoch milliseconds of record creation. */
  readonly createdAt: number
  /** Occurrence rule. */
  readonly trigger: AutomationTrigger
  /** What a due occurrence does. */
  readonly action: AutomationAction
  /** The latest settled run, or `null` before the first run. */
  readonly lastRun: AutomationRunSummary | null
  /** Prompt submitted on every run. */
  readonly prompt: string
  /** Optional explicit route; omission uses the current default-model selection. */
  readonly model?: AutomationModelSelection
}

/** Caller-facing occurrence rule; the runtime materializes the stored anchor. */
export type AutomationTriggerInput =
  | {
    /** Fires once at the given instant. */
    readonly kind: 'once'
    /** Unix epoch milliseconds; must target the future at creation. */
    readonly at: number
  }
  | {
    /** Fixed rate anchored at creation. */
    readonly kind: 'every'
    /** Whole seconds between occurrences; at least MIN_TRIGGER_INTERVAL_SECONDS. */
    readonly intervalSeconds: number
  }
  | {
    /** Cron expression evaluated in the configured time zone. */
    readonly kind: 'cron'
    /** Five- or six-field cron expression. */
    readonly expression: string
    /** IANA time zone; the process zone when omitted. */
    readonly timeZone?: string
  }

/** Input for creating one automation. */
export interface AutomationCreateInput {
  /** Diagnostic label; a non-empty string. */
  readonly title: string
  /** Occurrence rule. */
  readonly trigger: AutomationTriggerInput
  /** What a due occurrence does. */
  readonly action: AutomationAction
  /** Prompt submitted on every run; a non-empty string. */
  readonly prompt: string
  /** Optional explicit model route. */
  readonly model?: AutomationModelSelection
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Programmatic input admitted from one due automation run. */
    automation: {
      readonly kind: 'automation'
      readonly automationId: AutomationId
      readonly form: 'notice'
      readonly summary: string
    }
  }
}
