import fs from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { transform } from '../src/index.js'
import { Parser, type Group, type Property, type Variable } from 'cddl'

function variable(name: string, propertyType: Variable['PropertyType']): Variable {
    return {
        Type: 'variable',
        Name: name,
        PropertyType: propertyType,
        Comments: [],
        IsChoiceAddition: false
    }
}

function property(name: string, type: Property['Type']): Property {
    return {
        HasCut: false,
        Occurrence: { n: 1, m: 1 },
        Name: name,
        Type: type,
        Comments: []
    }
}

function group(name: string, properties: Group['Properties']): Group {
    return {
        Type: 'group',
        Name: name,
        IsChoiceAddition: false,
        Properties: properties,
        Comments: []
    }
}

describe('literal transformation direct', () => {
    it('should transform bigint literals correctly', () => {
        const assignment = variable('MyBigInt', {
            Type: 'literal',
            Value: 9007199254740995n
        } as any)

        const output = transform([assignment])
        expect(output).toContain('export type MyBigInt = 9007199254740995n;')
    })

    it('should transform float32 aliases correctly', () => {
        const assignment = variable('score', 'float32')

        const output = transform([assignment])
        expect(output).toContain('export type Score = number;')
    })

    it.each([
        ['integer-value', 'integer', 'number'],
        ['negative-value', 'nint', 'number'],
        ['unsigned-value', 'unsigned', 'number'],
        ['half-float', 'float16', 'number'],
        ['double-float', 'float64', 'number'],
        ['float-window', 'float16-32', 'number'],
        ['float-range', 'float32-64', 'number'],
        ['binary-payload', 'bytes', 'Uint8Array'],
        ['binary-blob', 'bstr', 'Uint8Array'],
        ['missing-value', 'undefined', 'undefined']
    ] as const)('should map %s (%s) to %s', (name, propertyType, expectedType) => {
        const output = transform([variable(name, propertyType)])
        expect(output).toContain(`export type ${name.split('-').map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`).join('')} = ${expectedType};`)
    })

    it.each([
        ['cbor', 'inner'],       // .cbor's argument matches a single decoded item - a map is fine
        ['cborseq', 'innerList'] // .cborseq's argument matches the sequence taken as an array (RFC 8610 §3.8.4)
    ] as const)('should ignore the .%s operator and still map bstr to Uint8Array', (operatorType, referencedType) => {
        // Either way this is a validation constraint on a byte string, not a structural
        // type change - same as every other operator (.size, .and, ...); the generator
        // never looks at what the reference resolves to.
        const output = transform([variable('payload', {
            Type: 'bstr',
            Operator: {
                Type: operatorType,
                Value: { Type: 'group', Value: referencedType, Unwrapped: false }
            }
        } as any)])
        expect(output).toContain('export type Payload = Uint8Array;')
    })

    it('should keep bytes fields as object properties instead of record aliases', () => {
        const output = transform([
            group('network-get-data-result', [
                property('bytes', {
                    Type: 'group',
                    Value: 'network.BytesValue',
                    Unwrapped: false
                } as any)
            ])
        ])

        expect(output).toContain('export interface NetworkGetDataResult {')
        expect(output).toContain('bytes: NetworkBytesValue;')
        expect(output).not.toContain('export type NetworkGetDataResult = Record')
    })

    it('should map byte-string literals to Uint8Array while keeping text literals as string types', () => {
        const output = transform([
            variable('byte-lit', { Type: 'literal', Value: "h'0102'", Unwrapped: false, IsBytes: true }),
            variable('text-lit', { Type: 'literal', Value: "h'0102'", Unwrapped: false })
        ])

        expect(output).toContain('export type ByteLit = Uint8Array;')
        expect(output).toContain('export type TextLit = "h\'0102\'";')
    })

    it('should transform constrained parenthesized choices, inline arrays/groups, and nested operators from parser output', () => {
        const src = [
            'allowed = [int]',
            'choice-arr = [0 / (int / tstr) .default 0]',
            'inline-arr = [0 / [int] .within allowed]',
            'inline-group = [0 / { a: int } .within allowed]',
            'nested-op = [0 / (float .ge 0.0) .default 1.0]',
            'regexp-nested = [0 / (tstr .regexp "^a.+b$") .default "ab"]',
        ].join('\n') + '\n'
        const spy = vi.spyOn(fs, 'readFileSync').mockReturnValue(src)
        try {
            const ast = new Parser('constrained.cddl').parse()
            const output = transform(ast)
            expect(output).toContain('export type ChoiceArr = (0 | number | string)[];')
            expect(output).toContain('export type InlineArr = (0 | number[])[];')
            expect(output).toContain('export type InlineGroup = (0 | {')
            expect(output).toContain('a: number;')
            expect(output).toContain('export type NestedOp = (0 | number)[];')
            expect(output).toContain('export type RegexpNested = (0 | `a${string}b`)[];')
        } finally {
            spy.mockRestore()
        }
    })
})
