/**
 * Error vocabulary for the memory capability seam.
 * @module @deepseek-ai/dsh-memory/src/error
 */

/** Discriminant codes carried by every {@link MemoryError}. */
export type MemoryErrorCode =
  | 'duplicate-provider'
  | 'provider-missing'
  | 'invalid-content'
  | 'content-too-large'

/**
 * Error contract shared by the memory service and its providers. The hub
 * throws the wiring codes (`duplicate-provider`, `provider-missing`);
 * providers throw the record-input codes (`invalid-content`,
 * `content-too-large`) so consumers can handle rejected records without
 * importing any specific provider. The `code` is the stable contract
 * consumers may switch on; `message` is diagnostic prose.
 */
export class MemoryError extends Error {
  override readonly name = 'MemoryError'

  /**
   * @param code - Stable discriminant for the failure class.
   * @param message - Human-readable diagnostic detail.
   * @param options - Standard error options (`cause`).
   */
  constructor(
    readonly code: MemoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
