/** Record-only worker tool-call telemetry: observes session events and never changes tool admission. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import { ticketOfSession } from '../executor/dsh.ts'
import { KV } from '../kv.ts'
import { LIMITS } from '../limits.ts'
import type { Store } from './store.ts'

/** One UTC day of worker tool-call aggregates. */
export interface TelemetryDay {
  toolCalls: number
  byTool: Record<string, number>
  overCapTurns: number
  maxCallsPerTurn: number
}

/** The operator-facing telemetry window; `activation` names that nothing is enforced. */
export interface TelemetrySnapshot extends TelemetryDay {
  windowDays: number
  since: string
  callCapPerTurn: number
  activation: 'record-only'
}

const EMPTY = (): TelemetryDay => ({ toolCalls: 0, byTool: {}, overCapTurns: 0, maxCallsPerTurn: 0 })
const DAY_MS = 86_400_000
const MAX_TRACKED_TURNS = 10_000

/**
 * Counts worker `tool/call` events into per-UTC-day KV aggregates and reports the recent window.
 * Only Sessions whose id carries the worker prefix are counted; the orchestrator, subagents and unknown Sessions are ignored.
 * Delegated subagent calls are therefore not part of this first record-only version.
 */
export class Telemetry {
  /** Per `session:turn` counts, used only to detect the first call over the cap in a turn. */
  private readonly turns = new Map<string, number>()
  constructor(private readonly store: Pick<Store, 'get' | 'set'>,
    private readonly options = LIMITS.telemetry, private readonly now = () => Date.now()) {}

  /** Subscribes to worker tool calls and returns the disposer. */
  install(ctx: Context): () => void {
    return ctx.on('session/event', (session, event) => {
      if (event.type !== 'tool/call' || ticketOfSession(session.id) === undefined) return
      this.record(session.id, event.data.turn, event.data.name)
    })
  }

  /** Counts one worker tool call; public for tests and future consumers. */
  record(sessionId: string, turn: number, tool: string): void {
    const day = new Date(this.now()).toISOString().slice(0, 10)
    const key = KV.telemetry.days(day)
    const current = this.store.get(key) ?? EMPTY()
    const turnKey = `${sessionId}:${turn}`
    const count = (this.turns.get(turnKey) ?? 0) + 1
    this.turns.set(turnKey, count)
    if (this.turns.size > MAX_TRACKED_TURNS) this.turns.clear()
    const overCap = count === this.options.callCapPerTurn + 1
    this.store.set(key, {
      toolCalls: current.toolCalls + 1,
      byTool: { ...current.byTool, [tool]: (current.byTool[tool] ?? 0) + 1 },
      overCapTurns: current.overCapTurns + (overCap ? 1 : 0),
      maxCallsPerTurn: Math.max(current.maxCallsPerTurn, count),
    })
  }

  /** Aggregates the last `windowDays` UTC days, including today. */
  snapshot(): TelemetrySnapshot {
    const total = EMPTY()
    const now = new Date(this.now())
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    for (let offset = this.options.windowDays - 1; offset >= 0; offset -= 1) {
      const value = this.store.get(KV.telemetry.days(new Date(today - offset * DAY_MS).toISOString().slice(0, 10)))
      if (!value) continue
      total.toolCalls += value.toolCalls
      total.overCapTurns += value.overCapTurns
      total.maxCallsPerTurn = Math.max(total.maxCallsPerTurn, value.maxCallsPerTurn)
      for (const [tool, count] of Object.entries(value.byTool)) total.byTool[tool] = (total.byTool[tool] ?? 0) + count
    }
    const since = new Date(today - (this.options.windowDays - 1) * DAY_MS).toISOString().slice(0, 10)
    return { ...total, windowDays: this.options.windowDays, since,
      callCapPerTurn: this.options.callCapPerTurn, activation: 'record-only' }
  }
}
