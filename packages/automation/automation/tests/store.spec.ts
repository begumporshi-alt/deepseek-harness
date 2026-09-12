/** Durable store file IO: round-trips, atomic writes, and format rejection. */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AutomationId } from '../src/brand.ts'
import { createAutomationRecord } from '../src/domain.ts'
import { AutomationFileStore, readAutomationStore, writeAutomationStore } from '../src/store.ts'
import type { AutomationRecord } from '../src/types.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const NOW = Date.parse('2026-09-12T10:00:00Z')

/** One valid record for store round-trips. */
function sample(id: string): AutomationRecord {
  return createAutomationRecord({
    title: 'nightly report',
    prompt: 'Summarize today.',
    trigger: { kind: 'once', at: NOW + 60_000 },
    action: { kind: 'new-session', cwd: '/tmp' },
  }, AutomationId(id), NOW)
}

describe('readAutomationStore', () => {
  it('reads a missing file as empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-automation-store-'))
    roots.push(root)
    await expect(readAutomationStore(join(root, 'automations.json'))).resolves.toEqual([])
  })

  it('rethrows non-missing-file read failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-automation-store-'))
    roots.push(root)
    // Reading a directory path fails with EISDIR, not ENOENT.
    await expect(readAutomationStore(root)).rejects.toThrow()
  })

  it('round-trips written records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-automation-store-'))
    roots.push(root)
    const path = join(root, 'automations.json')
    await writeAutomationStore(path, [sample('a1'), sample('a2')])
    await expect(readAutomationStore(path)).resolves.toEqual([sample('a1'), sample('a2')])
  })

  it('refuses unsupported format versions and malformed files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-automation-store-'))
    roots.push(root)
    const path = join(root, 'automations.json')
    await writeFile(path, JSON.stringify({ formatVersion: 99, automations: [] }), 'utf8')
    await expect(readAutomationStore(path)).rejects.toThrow(/formatVersion/)
    await writeFile(path, JSON.stringify({ formatVersion: 1, automations: 'x' }), 'utf8')
    await expect(readAutomationStore(path)).rejects.toThrow(/automations array/)
    await writeFile(path, '[1,2]', 'utf8')
    await expect(readAutomationStore(path)).rejects.toThrow(/object/)
    await writeFile(path, '{not json', 'utf8')
    await expect(readAutomationStore(path)).rejects.toThrow()
  })

  it('refuses a decoded entry that is not one well-formed record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-automation-store-'))
    roots.push(root)
    const path = join(root, 'automations.json')
    await writeFile(path, JSON.stringify({ formatVersion: 1, automations: [{ id: 'x' }] }), 'utf8')
    await expect(readAutomationStore(path)).rejects.toThrow(TypeError)
  })
})

describe('writeAutomationStore', () => {
  it('creates missing parent directories and leaves no temporary file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-automation-store-'))
    roots.push(root)
    const path = join(root, 'nested', 'dir', 'automations.json')
    await writeAutomationStore(path, [sample('a1')])
    await expect(readdir(join(root, 'nested', 'dir'))).resolves.toEqual(['automations.json'])
    const text = await readFile(path, 'utf8')
    expect(text).toContain('"formatVersion": 1')
    expect(text.endsWith('\n')).toBe(true)
  })
})

describe('AutomationFileStore', () => {
  it('serializes saves in call order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-automation-store-'))
    roots.push(root)
    const store = new AutomationFileStore(join(root, 'automations.json'))
    const first = store.persist([sample('a1')])
    const second = store.persist([sample('a2')])
    await Promise.all([first, second])
    await expect(store.load()).resolves.toEqual([sample('a2')])
    await expect(readAutomationStore(join(root, 'automations.json'))).resolves.toEqual([sample('a2')])
  })

  it('propagates save failures without corrupting the serialized chain', async () => {
    const store = new AutomationFileStore('/dev/null/automations.json')
    await expect(store.persist([sample('a1')])).rejects.toThrow()
    const root = await mkdtemp(join(tmpdir(), 'dsh-automation-store-'))
    roots.push(root)
    const path = join(root, 'automations.json')
    const recovered = new AutomationFileStore(path)
    const usable = store.persist([sample('a2')])
    await expect(usable).rejects.toThrow()
    await expect(recovered.persist([sample('a3')])).resolves.toBeUndefined()
    await expect(readAutomationStore(path)).resolves.toEqual([sample('a3')])
  })
})
