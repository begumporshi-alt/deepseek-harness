/**
 * Convert one harness tool parameter schema (the lossless dialect with
 * per-property `required: true` markers) into a standard JSON Schema object
 * with top-level `required` arrays, the shape MCP clients expect on
 * `tools/list`.
 * @module @deepseek-ai/dsh-mcp-server/src/schema
 */

/**
 * Recursively convert one schema node. Object nodes collect their
 * `required: true` properties into a top-level `required` array and recurse
 * into every property; arrays recurse into their items; everything else is
 * copied verbatim. Unknown keys survive unchanged, so MCP vocabulary an
 * annotation already carries is never lost.
 * @param node - The schema node (or nested value) to convert.
 * @returns the converted node.
 */
export function dshSchemaToMcp(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(entry => dshSchemaToMcp(entry))
  if (node === null || typeof node !== 'object') return node
  const source = node as Record<string, unknown>
  const result: Record<string, unknown> = {}
  const properties = source.properties
  if (properties !== null && typeof properties === 'object' && !Array.isArray(properties)) {
    const converted: Record<string, unknown> = {}
    const required: string[] = []
    for (const [name, property] of Object.entries(properties)) {
      const marked = property !== null && typeof property === 'object' && (property as { required?: unknown }).required === true
      if (marked) required.push(name)
      converted[name] = dshSchemaToMcp(property)
    }
    result.properties = converted
    if (required.length > 0) result.required = required
  }
  for (const [key, value] of Object.entries(source)) {
    if (key === 'properties' || key === 'required') continue
    result[key] = dshSchemaToMcp(value)
  }
  if (result.required === undefined && Array.isArray(source.required)) {
    result.required = source.required
  }
  return result
}
