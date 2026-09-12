import { describe, expect, it } from 'vitest'
import { dshSchemaToMcp } from '@deepseek-ai/dsh-mcp-server'

describe('dshSchemaToMcp', () => {
  it('collects per-property required markers into a top-level array', () => {
    const converted = dshSchemaToMcp({
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, enum: ['user', 'project'] },
        note: { type: 'string' },
      },
    }) as { required?: string[]; properties: Record<string, Record<string, unknown>> }
    expect(converted.required).toEqual(['kind'])
    expect(converted.properties.kind).toEqual({ type: 'string', enum: ['user', 'project'] })
    expect(converted.properties.note).toEqual({ type: 'string' })
  })

  it('omits required when no property is required', () => {
    const converted = dshSchemaToMcp({
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string' } },
    }) as Record<string, unknown>
    expect(converted.required).toBeUndefined()
  })

  it('converts nested object properties recursively', () => {
    const converted = dshSchemaToMcp({
      type: 'object',
      properties: {
        target: {
          type: 'object',
          additionalProperties: false,
          properties: {
            date: { type: 'string', required: true },
            zone: { type: 'string' },
          },
        },
      },
    }) as { properties: { target: { required?: string[] } } }
    expect(converted.properties.target.required).toEqual(['date'])
  })

  it('converts oneOf branches', () => {
    const converted = dshSchemaToMcp({
      type: 'object',
      properties: {
        at: {
          oneOf: [
            { type: 'string' },
            { type: 'object', properties: { date: { type: 'string', required: true } } },
          ],
        },
      },
    }) as { properties: { at: { oneOf: Array<Record<string, unknown>> } } }
    expect(converted.properties.at.oneOf[1]).toMatchObject({ required: ['date'] })
  })

  it('preserves a pre-existing top-level required array', () => {
    const converted = dshSchemaToMcp({
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'string' } },
    }) as { required?: string[] }
    expect(converted.required).toEqual(['a'])
  })

  it('copies scalars and arrays verbatim', () => {
    expect(dshSchemaToMcp('string')).toBe('string')
    expect(dshSchemaToMcp(null)).toBe(null)
    expect(dshSchemaToMcp(['a', { type: 'string' }])).toEqual(['a', { type: 'string' }])
  })
})
