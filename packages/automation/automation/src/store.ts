/**
 * Durable automation store: one JSON file holding every record, written
 * atomically (temporary file plus rename) with saves serialized in call order.
 * @module @deepseek-ai/dsh-automation/src/store
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { decodeAutomationRecord } from './domain.ts'
import type { AutomationRecord } from './types.ts'

/** Monotonic on-disk format generation; readers refuse other values. */
export const STORE_FORMAT_VERSION = 1

/** Whole shape of the store file. */
export interface AutomationStoreFile {
  readonly formatVersion: typeof STORE_FORMAT_VERSION
  readonly automations: readonly AutomationRecord[]
}

/**
 * Read and decode one store file.
 * @param path - absolute store path.
 * @returns the decoded records; a missing file reads as empty.
 * @throws when the file exists but is not a well-formed store of the current format.
 */
export async function readAutomationStore(path: string): Promise<AutomationRecord[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`automation store ${JSON.stringify(path)} must hold an object`)
  }
  const record = parsed as Record<string, unknown>
  if (record['formatVersion'] !== STORE_FORMAT_VERSION) {
    throw new TypeError(`automation store ${JSON.stringify(path)} has unsupported formatVersion ${JSON.stringify(record['formatVersion'])}`)
  }
  if (!Array.isArray(record['automations'])) {
    throw new TypeError(`automation store ${JSON.stringify(path)} must hold an automations array`)
  }
  return record['automations'].map(decodeAutomationRecord)
}

/**
 * Atomically write one store file.
 * @param path - absolute store path.
 * @param records - the complete record set; the file always holds the full state.
 */
export async function writeAutomationStore(path: string, records: readonly AutomationRecord[]): Promise<void> {
  const file: AutomationStoreFile = { formatVersion: STORE_FORMAT_VERSION, automations: records }
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

/**
 * File-backed record set with save-call serialization. Every mutation goes
 * through {@link AutomationFileStore#persist}, which writes the complete state.
 */
export class AutomationFileStore {
  private save: Promise<void> = Promise.resolve()

  /**
   * Construct one store bound to a file path.
   * @param path - absolute store path; the directory is created on first write.
   */
  constructor(readonly path: string) {}

  /**
   * Read every durable record.
   * @returns the decoded records; a missing file reads as empty.
   * @throws when the file exists but is not a well-formed current-format store.
   */
  load(): Promise<AutomationRecord[]> {
    return readAutomationStore(this.path)
  }

  /**
   * Persist the complete record set, ordered after every earlier save.
   * @param records - the full record set to write.
   */
  persist(records: readonly AutomationRecord[]): Promise<void> {
    this.save = this.save.then(() => writeAutomationStore(this.path, records))
    return this.save
  }
}
