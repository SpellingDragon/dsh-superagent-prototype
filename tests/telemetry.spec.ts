/** Symptom anchor: worker tool calls are visible as record-only telemetry, and the main Session is excluded. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { await h.stop() })

function call(sessionId: string, turn: number, callId: string): void {
  h.ctx.emit('session/event', { id: sessionId } as never,
    { type: 'tool/call', data: { turn, step: 1, callId, name: 'bash', arguments: '{}' } } as never)
}

it('counts worker tool calls and over-cap turns', async () => {
  for (let index = 0; index < 9; index += 1) call('worker-telemetry', 1, `call-${index}`)
  const { body } = await h.api('GET', 'overview')
  const telemetry = body.telemetry as { toolCalls: number; overCapTurns: number; maxCallsPerTurn: number; activation: string }
  expect(telemetry.toolCalls).toBeGreaterThanOrEqual(9)
  expect(telemetry.overCapTurns).toBe(1)
  expect(telemetry.maxCallsPerTurn).toBe(9)
  expect(telemetry.activation).toBe('record-only')
})

it('ignores the main session', async () => {
  call(h.runtime.masterId, 1, 'main-call')
  const { body } = await h.api('GET', 'overview')
  const telemetry = body.telemetry as { toolCalls: number }
  expect(telemetry.toolCalls).toBe(0)
})

it('does not count the same turn twice as over-cap', async () => {
  for (let index = 0; index < 14; index += 1) call('worker-telemetry', 7, `call-${index}`)
  const { body } = await h.api('GET', 'overview')
  const telemetry = body.telemetry as { overCapTurns: number }
  expect(telemetry.overCapTurns).toBe(1)
})
