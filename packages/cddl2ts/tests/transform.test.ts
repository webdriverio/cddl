import { describe, it, expect } from 'vitest'
import { transform } from '../src/index.js'
import type { Group, Property, Variable } from 'cddl'

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
})
