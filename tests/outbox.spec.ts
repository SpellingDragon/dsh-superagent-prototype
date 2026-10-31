/** Outbox delivery when processing is paused or a Source kind registers late. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { OutboundMessage } from '../src/core/index.ts'
import { Commands } from '../src/infra/commands.ts'
import type { SourceKind } from '../src/sources/kind.ts'
import { feishu, startRuntime, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { await h.stop() })
async function at(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ms })
  try { await h.runtime.pump(); await h.runtime.sendReplies() } finally { vi.useRealTimers() }
}

it('holds every message while processing is paused, and sends it once processing resumes', async () => {
  const lark = vi.mocked(Commands.prototype.lark)
  await h.runtime.settings.pause(true, 'panel')
  lark.mockClear()
  h.runtime.outbox.send({ id: 'held', channel: feishu('1', 'x').channel!, text: '已合并。', kind: 'notice' })
  await h.runtime.sendReplies()
  expect([h.runtime.outbox.status('held'), lark.mock.calls.length]).toEqual(['pending', 0])
  await h.runtime.settings.pause(false, 'panel')
  await h.runtime.pump(); await h.runtime.sendReplies()
  expect(h.runtime.outbox.status('held')).toBe('sent')
  expect(JSON.stringify(lark.mock.calls)).toContain('已合并。')
})

it('keeps a message for a Source that is not installed waiting, and sends it once the Source\'s kind registers', async () => {
  const sent: OutboundMessage[] = []
  const probe: SourceKind<Record<string, never>> = { kind: 'probe', title: { zh: '探针', en: 'Probe' }, description: { zh: '', en: '' }, health: [],
    schema: z.object({}).strict(), fields: [],
    channel: { send: async (_host, message) => { sent.push(message); return 'sent' }, link: () => ({ url: '', label: { zh: '探针', en: 'Probe' } }) } }
  h.runtime.outbox.send({ id: 'waiting', channel: { source: 'probe', thread: 'probe:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  expect([h.runtime.outbox.status('waiting'), h.runtime.health.reply?.state]).toEqual(['pending', 'ready'])
  h.runtime.sources.register(probe)
  // A message whose Source was not installed is tried again after 5 seconds.
  await at(5000)
  expect([h.runtime.outbox.status('waiting'), sent.map(message => message.id)]).toEqual(['sent', ['waiting']])
})

it('retries a reply left pending by the previous process at startup', async () => {
  const seeded = await startRuntime(store => {
    const channel = feishu('9', 'x').channel!
    const message = { id: 'restart-seeded', channel, text: 'Done', kind: 'reply' as const }
    store.db.prepare('INSERT INTO outbox (id, value) VALUES (?, ?)').run(message.id, JSON.stringify({ ...message, status: 'pending' }))
    store.db.prepare(`INSERT INTO effect (kind, key, value, seq, generation, attempts, error, due, since)
      VALUES ('reply', ?, '{}', 1, 0, 0, '', ?, ?)`)
      .run(message.id, Date.now() + 3_600_000, new Date(Date.now() - 600_000).toISOString())
  })
  try {
    // Sources register after Runtime startup; once registered, the reconciled reply can go out.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 5_000 })
    try {
      await seeded.runtime.pump()
      await seeded.runtime.sendReplies()
    } finally { vi.useRealTimers() }
    expect(seeded.runtime.outbox.status('restart-seeded')).toBe('sent')
  } finally { await seeded.stop() }
})

it('returns pending replies as owed and makes them due', async () => {
  h.runtime.outbox.send({ id: 'restart-owed', channel: { source: 'probe', thread: 'probe:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  expect(h.runtime.outbox.status('restart-owed')).toBe('pending')
  const owed = h.runtime.outbox.reconcile()
  expect(owed.map(item => item.id)).toContain('restart-owed')
  const row = h.runtime.store.db.prepare("SELECT due FROM effect WHERE kind = 'reply' AND key = ?").get('restart-owed') as { due: number }
  expect(row.due).toBeLessThanOrEqual(Date.now())
})

it('does not report a sent reply as owed', async () => {
  h.runtime.outbox.send({ id: 'already-sent', channel: feishu('1', 'x').channel!, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  expect(h.runtime.outbox.status('already-sent')).toBe('sent')
  expect(h.runtime.outbox.reconcile().map(item => item.id)).not.toContain('already-sent')
})

it('does not show a fresh pending reply in overview', async () => {
  h.runtime.outbox.send({ id: 'fresh-pending', channel: { source: 'probe', thread: 'probe:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  const fresh = await h.api('GET', 'overview')
  expect((fresh.body.problems as { kind: string }[]).some(problem => problem.kind === 'owed')).toBe(false)
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 120_000 })
  try {
    const later = await h.api('GET', 'overview')
    expect((later.body.problems as { kind: string; outgoing: { id: string } }[])
      .some(problem => problem.kind === 'owed' && problem.outgoing.id === 'fresh-pending')).toBe(true)
  } finally { vi.useRealTimers() }
})
