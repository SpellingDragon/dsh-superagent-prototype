/** Symptom anchor: every Session the Runtime creates runs under a workspace-confined permission preset. */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { feishu, startRuntime, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { await h.stop() })

it('selects the workspace-write preset for every superagent session', async () => {
  await h.acceptedTicket(feishu('1', 'Fix the typo in the README'))
  expect(h.permissionSets.length).toBeGreaterThanOrEqual(2)
  expect(h.permissionSets.every(([, preset]) => preset === 'workspace-write')).toBe(true)
})

it('never selects danger-full-access', async () => {
  await h.acceptedTicket(feishu('2', 'Fix the typo in the README'))
  const presets = h.permissionSets.map(([, preset]) => String(preset))
  expect(presets).not.toContain('danger-full-access')
})
