import { describe, expect, it } from 'vitest'

import type {
    Array as CDDLArray,
    Comment,
    Group,
    Operator,
    Property,
    PropertyReference,
    Variable
} from 'cddl'

import { transform } from '../src/index.js'

const COMMENTS: Comment[] = []

function comment (content: string, leading = false): Comment {
    return {
        Type: 'comment',
        Content: content,
        Leading: leading
    }
}

function groupRef (value: string, operator?: Operator): PropertyReference {
    return {
        Type: 'group',
        Value: value,
        Unwrapped: false,
        Operator: operator
    }
}

function literal (value: unknown): PropertyReference {
    return {
        Type: 'literal',
        Value: value as any,
        Unwrapped: false
    } as PropertyReference
}

function rangeRef (): PropertyReference {
    return {
        Type: 'range',
        Value: {
            Min: 0,
            Max: 10,
            Inclusive: true
        },
        Unwrapped: false
    }
}

function property (
    name: string,
    type: Property['Type'],
    overrides: Partial<Property> = {}
): Property {
    return {
        HasCut: false,
        Occurrence: { n: 1, m: 1 },
        Name: name,
        Type: type,
        Comments: COMMENTS,
        ...overrides
    }
}

function unnamedProperty (
    type: Property['Type'],
    overrides: Partial<Property> = {}
): Property {
    return property('', type, overrides)
}

function group (
    name: string,
    properties: Group['Properties'],
    comments: Comment[] = COMMENTS
): Group {
    return {
        Type: 'group',
        Name: name,
        IsChoiceAddition: false,
        Properties: properties,
        Comments: comments
    }
}

function array (
    name: string,
    values: CDDLArray['Values'],
    comments: Comment[] = COMMENTS
): CDDLArray {
    return {
        Type: 'array',
        Name: name,
        Values: values,
        Comments: comments
    }
}

function variable (
    name: string,
    propertyType: Variable['PropertyType'],
    comments: Comment[] = COMMENTS
): Variable {
    return {
        Type: 'variable',
        Name: name,
        PropertyType: propertyType,
        IsChoiceAddition: false,
        Comments: comments
    }
}

describe('transform edge cases', () => {
    it('should map any to unknown when configured', () => {
        const output = transform([
            variable('maybe-value', 'any')
        ], { useUnknown: true })

        expect(output).toContain('export type MaybeValue = unknown;')
    })

    it('should generate intersections for choices with static props and mixins', () => {
        const output = transform([
            group('combined', [
                [
                    unnamedProperty(groupRef('option-a')),
                    unnamedProperty(groupRef('option-b'))
                ],
                property('enabled', 'bool'),
                unnamedProperty([groupRef('mixin-a'), groupRef('mixin-b')])
            ])
        ])

        expect(output).toContain('export type Combined =')
        expect(output).toContain('enabled: boolean')
        expect(output).toContain('OptionA | OptionB')
        expect(output).toContain('MixinA | MixinB')
    })

    it('should resolve deeply wrapped group mixins into intersections', () => {
        const output = transform([
            group('wrapped-mixins', [
                unnamedProperty(group('', [
                    [
                        unnamedProperty(groupRef('choice-a')),
                        unnamedProperty(groupRef('choice-b'))
                    ],
                    unnamedProperty([
                        unnamedProperty(groupRef('wrapped-a')) as any,
                        unnamedProperty(groupRef('wrapped-b')) as any
                    ] as any),
                    unnamedProperty([
                        [
                            unnamedProperty(groupRef('nested-a')) as any,
                            unnamedProperty(groupRef('nested-b')) as any
                        ]
                    ] as any),
                    unnamedProperty([unnamedProperty(groupRef('scalar-ref')) as any] as any),
                    unnamedProperty(group('', [
                        property('flag', 'bool')
                    ]))
                ])),
                property('name', 'tstr')
            ])
        ])

        expect(output).toContain('export type WrappedMixins =')
        expect(output).toContain('ChoiceA | ChoiceB')
        expect(output).toContain('WrappedA | WrappedB')
        expect(output).toContain('NestedA | NestedB')
        expect(output).toContain('ScalarRef')
        expect(output).toContain('flag: boolean')
        expect(output).toContain('name: string')
    })

    it('should resolve tuples, records, arrays, literals and special references', () => {
        const output = transform([
            variable('tuple-type', group('', [
                unnamedProperty('int'),
                unnamedProperty('tstr')
            ]) as any),
            variable('choice-type', group('', [
                [unnamedProperty('int'), unnamedProperty('tstr')],
                property('flag', 'bool')
            ]) as any),
            variable('record-type', group('', [
                property('text', ['tstr'])
            ]) as any),
            variable('array-type', array('', [
                unnamedProperty(['int', groupRef('custom-value')])
            ]) as any),
            variable('null-type', { Type: 'group', Value: 'null', Unwrapped: false }),
            variable('range-type', rangeRef()),
            variable('pointer-type', {
                Type: groupRef('pointer-value'),
                Operator: { Type: 'default', Value: literal('mouse') }
            }),
            variable('bool-literal', literal(true)),
            variable('null-literal', literal(null))
        ])

        expect(output).toContain('export type TupleType = [number, string];')
        expect(output).toContain('export type ChoiceType = [number, string] | {')
        expect(output).toContain('export type RecordType = Record<string, string>;')
        expect(output).toContain('export type ArrayType = (number | CustomValue)[];')
        expect(output).toContain('export type NullType = null;')
        expect(output).toContain('export type RangeType = number;')
        expect(output).toContain('export type PointerType = PointerValue;')
        expect(output).toContain('export type BoolLiteral = true;')
        expect(output).toContain('export type NullLiteral = null;')
    })

    it('should include optional properties and default tags in object docs', () => {
        const output = transform([
            group('defaults', [
                property('count', 'int', {
                    Operator: { Type: 'default', Value: literal(7) },
                    Comments: [comment('count docs')]
                }),
                property('status', groupRef('status-value', {
                    Type: 'default',
                    Value: literal('ready')
                }), {
                    Comments: [comment('status docs')]
                }),
                property('enabled', 'bool', {
                    Occurrence: { n: 0, m: 1 }
                })
            ])
        ])

        expect(output).toContain('* count docs')
        expect(output).toContain(`* @default 7`)
        expect(output).toContain('* status docs')
        expect(output).toContain(`* @default 'ready'`)
        expect(output).toContain('enabled?: boolean')
    })

    it('should place leading comments before exported declarations', () => {
        const output = transform([
            variable('metadata-scalar', ['null', 'bool', 'int', 'float', 'text'], [
                comment('Flat scalar value used by concise metadata bags.', true)
            ])
        ])

        expect(output).toContain(`// Flat scalar value used by concise metadata bags.\nexport type MetadataScalar = null | boolean | number | number | string;`)
        expect(output).not.toContain('export // Flat scalar value used by concise metadata bags.')
    })

    it('should emit extensible object properties as index signatures', () => {
        const output = transform([
            variable('metadata-scalar', ['null', 'bool', 'int', 'float', 'text']),
            group('message-metadata', [
                property('provider', 'text', {
                    Occurrence: { n: 0, m: 1 }
                }),
                property('model', 'text', {
                    Occurrence: { n: 0, m: 1 }
                }),
                property('text', groupRef('metadata-scalar'), {
                    Occurrence: { n: 0, m: Infinity }
                })
            ])
        ])

        expect(output).toContain('export interface MessageMetadata {')
        expect(output).toContain('provider?: string;')
        expect(output).toContain('model?: string;')
        expect(output).toContain('[key: string]: MetadataScalar | undefined;')
        expect(output).not.toContain('text?: MetadataScalar;')
    })

    it('should throw clear errors for unsupported inputs', () => {
        expect(() => transform([
            variable('unknown-native', 'nope')
        ])).toThrow('Unknown native type: "nope')

        expect(() => transform([
            variable('bad-literal', literal({ nope: true }))
        ])).toThrow('Unsupported literal type')

        expect(() => transform([
            variable('bad-group', { Type: 'group', Value: false, Unwrapped: false } as any)
        ])).toThrow('Unknown group type')

        expect(() => transform([
            variable('bad-union', { Type: 'mystery', Value: 'x', Unwrapped: false } as any)
        ])).toThrow('Unknown union type')

        expect(() => transform([
            group('bad-default', [
                property('foo', 'int', {
                    Operator: { Type: 'default', Value: groupRef('no-literal') }
                })
            ])
        ])).toThrow(`Can't parse operator default value`)

        expect(() => transform([
            { Type: 'mystery' } as any
        ])).toThrow('Unknown assignment type')
    })
})
