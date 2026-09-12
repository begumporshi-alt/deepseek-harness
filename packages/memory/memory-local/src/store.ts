/**
 * Local filesystem store for memory entries. One markdown file per entry with
 * a minimal frontmatter header; the entries directory is the only source of
 * truth. All reads and writes go through `node:fs` — the provider owns the
 * medium, so harness filesystem policies do not gate service-level storage.
 * @module @deepseek-ai/dsh-memory-local/src/store
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import type { MemoryEntry, MemoryId, MemoryProvider, MemoryRecordInput } from '@deepseek-ai/dsh-memory'

/** Construction options for {@link LocalMemoryStore}; validated by the plugin Config. */
export interface LocalMemoryStoreOptions {
  /**
   * Resolve the directory holding the entries store. Invoked once on first
   * use and cached; created on demand.
   */
  readonly resolveDir: () => Promise<string>
  /** Maximum characters of content one entry may hold. */
  readonly maxEntryChars: number
  /** Maximum number of entries returned by `list` and `search`. */
  readonly maxListEntries: number
  /** Clock override for tests; defaults to `Date.now`. */
  readonly now?: () => number
  /** Random suffix generator override for tests; defaults to 4 random bytes as hex. */
  readonly randomHex?: () => string
}

/** Frontmatter header line prefix followed by one `key: value` per field. */
const FRONTMATTER_DELIMITER = '---'

/**
 * Filesystem-backed {@link MemoryProvider}. Entries live as
 * `entries/<id>.md` markdown files with `id`, `kind`, `createdAt`, and
 * `updatedAt` frontmatter fields; a rejected operation leaves the stored set
 * unchanged. Reads are issued per call, so entries edited while the harness
 * is stopped are visible on the next use.
 */
export class LocalMemoryStore implements MemoryProvider {
  readonly id = 'local'

  private readonly resolveDir: () => Promise<string>
  private readonly maxEntryChars: number
  private readonly maxListEntries: number
  private readonly now: () => number
  private readonly randomHex: () => string
  private dirPromise: Promise<string> | undefined

  /**
   * @param options - Store location resolver, bounds, and optional test clock.
   */
  constructor(options: LocalMemoryStoreOptions) {
    this.resolveDir = options.resolveDir
    this.maxEntryChars = options.maxEntryChars
    this.maxListEntries = options.maxListEntries
    this.now = options.now ?? Date.now
    this.randomHex = options.randomHex ?? (() => randomBytes(4).toString('hex'))
  }

  /** @inheritDoc */
  async record(input: MemoryRecordInput): Promise<MemoryEntry> {
    const content = input.content
    if (content.trim().length === 0) {
      throw new MemoryError('invalid-content', 'memory content must not be empty')
    }
    if (content.length > this.maxEntryChars) {
      throw new MemoryError(
        'content-too-large',
        `memory content exceeds the configured limit of ${this.maxEntryChars} characters (got ${content.length})`,
      )
    }
    const id = await this.allocateId()
    const timestamp = this.now()
    const entry: MemoryEntry = {
      id,
      kind: input.kind,
      content,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await this.writeEntry(entry)
    return entry
  }

  /** @inheritDoc */
  async list(): Promise<readonly MemoryEntry[]> {
    const entries = await this.readAll()
    return entries.slice(0, this.maxListEntries)
  }

  /** @inheritDoc */
  async search(query: string): Promise<readonly MemoryEntry[]> {
    const needle = query.toLowerCase()
    const matches = (await this.readAll()).filter(entry => entry.content.toLowerCase().includes(needle))
    return matches.slice(0, this.maxListEntries)
  }

  /** @inheritDoc */
  async forget(id: MemoryId): Promise<boolean> {
    try {
      await rm(join(await this.entriesDir(), `${id}.md`))
      return true
    } catch {
      return false
    }
  }

  /** Resolve and cache the store directory, then scope its entries subdirectory. */
  private async entriesDir(): Promise<string> {
    this.dirPromise ??= this.resolveDir()
    return join(await this.dirPromise, 'entries')
  }

  /**
   * Allocate a unique entry id. The id embeds the current time in base 36
   * plus a random suffix, and the existence check defends against the
   * astronomically unlikely collision.
   */
  private async allocateId(): Promise<MemoryId> {
    for (;;) {
      const candidate = brandString<MemoryId>(`mem_${this.now().toString(36)}_${this.randomHex()}`)
      try {
        await readFile(join(await this.entriesDir(), `${candidate}.md`))
      } catch {
        return candidate
      }
    }
  }

  private async writeEntry(entry: MemoryEntry): Promise<void> {
    const entriesDir = await this.entriesDir()
    await mkdir(entriesDir, { recursive: true })
    const body = [
      FRONTMATTER_DELIMITER,
      `id: ${entry.id}`,
      `kind: ${entry.kind}`,
      `createdAt: ${entry.createdAt}`,
      `updatedAt: ${entry.updatedAt}`,
      FRONTMATTER_DELIMITER,
      entry.content,
      '',
    ].join('\n')
    await writeFileAtomic(join(entriesDir, `${entry.id}.md`), body, { mode: 0o600 })
  }

  /**
   * Read every entry file, newest change first. A malformed entry file fails
   * the read loudly, naming the file, instead of being silently skipped.
   */
  private async readAll(): Promise<MemoryEntry[]> {
    const entriesDir = await this.entriesDir()
    let names: string[]
    try {
      names = await readdir(entriesDir)
    } catch {
      return []
    }
    const entries: MemoryEntry[] = []
    for (const name of names) {
      if (!name.endsWith('.md')) continue
      const raw = await readFile(join(entriesDir, name), 'utf8')
      entries.push(parseEntry(raw, name))
    }
    return entries.sort((a, b) => b.updatedAt - a.updatedAt)
  }
}

/** Parse one entry file's frontmatter and body; throws naming the file on malformed content. */
function parseEntry(raw: string, fileName: string): MemoryEntry {
  const lines = raw.split('\n')
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw new Error(`memory-local: entry file ${fileName} is missing its frontmatter header`)
  }
  const closing = lines.indexOf(FRONTMATTER_DELIMITER, 1)
  if (closing < 0) {
    throw new Error(`memory-local: entry file ${fileName} has an unterminated frontmatter header`)
  }
  const fields = new Map<string, string>()
  for (const line of lines.slice(1, closing)) {
    const separator = line.indexOf(':')
    if (separator < 0) {
      throw new Error(`memory-local: entry file ${fileName} has a malformed frontmatter line: ${JSON.stringify(line)}`)
    }
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  const id = fields.get('id')
  const kind = fields.get('kind')
  const createdAt = Number(fields.get('createdAt'))
  const updatedAt = Number(fields.get('updatedAt'))
  if (id === undefined || id.length === 0 || !isEntryKind(kind) || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) {
    throw new Error(`memory-local: entry file ${fileName} is missing required frontmatter fields`)
  }
  const content = lines.slice(closing + 1).join('\n').replace(/\n$/, '')
  return { id: brandString<MemoryId>(id), kind, content, createdAt, updatedAt }
}

/** Narrow one frontmatter kind value to the closed entry kind union. */
function isEntryKind(value: string | undefined): value is MemoryEntry['kind'] {
  return value === 'user' || value === 'feedback' || value === 'project' || value === 'reference'
}
