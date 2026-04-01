import { describe, expect, it } from 'vitest'

import type {
    Array as CDDLArray,
    Comment,
    Group,
    Operator,
    Property,
    PropertyReference,
    Tag,
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

function tagRef (typePart: string): PropertyReference {
    return {
        Type: 'tag',
        Value: {
            NumericPart: 1,
            TypePart: typePart
        } satisfies Tag,
        Unwrapped: false
    }
}

function literal (value: unknown): PropertyReference {
    return {
        Type: 'literal',
        Value: value as any,
        Unwrapped: false
    } as PropertyReference
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
    it('should generate pydantic variants for union mixins with shared fields', () => {
        const output = transform([
            group('base', [property('kind', 'tstr')]),
            group('mixin-a', [property('a', 'int')]),
            group('mixin-b', [property('b', 'int')]),
            group('combined', [
                unnamedProperty(groupRef('base')),
                unnamedProperty([groupRef('mixin-a'), groupRef('mixin-b')]),
                property('enabled', 'bool', {
                    Occurrence: { n: 0, m: 1 },
                    Operator: { Type: 'default', Value: literal(true) },
                    Comments: [comment('inline docs')]
                })
            ], [comment('shared union mixin', true)])
        ], { pydantic: true })

        expect(output).toContain('# shared union mixin')
        expect(output).toContain('class _CombinedFields(BaseModel):')
        expect(output).toContain('enabled: Optional[bool] = Field(default=True)  # inline docs')
        expect(output).toContain('class _CombinedVariant0(_CombinedFields, MixinA, Base):')
        expect(output).toContain('class _CombinedVariant1(_CombinedFields, MixinB, Base):')
        expect(output).toContain('Combined = Union[_CombinedVariant0, _CombinedVariant1]')
    })

    it('should collapse multiple union mixin groups into a single alias', () => {
        const output = transform([
            group('combined', [
                unnamedProperty(groupRef('base')),
                unnamedProperty([groupRef('mixin-a'), groupRef('mixin-b')]),
                unnamedProperty([groupRef('mixin-c'), groupRef('mixin-d')])
            ])
        ])

        expect(output).toContain('Combined = Union[Base, MixinA, MixinB, MixinC, MixinD]')
    })

    it('should handle empty arrays, choice arrays and nested arrays', () => {
        const output = transform([
            array('empty-list', [], [comment('empty array', true)]),
            array('choice-list', [[
                unnamedProperty('int'),
                unnamedProperty('tstr')
            ]]),
            array('nested-list', [
                unnamedProperty(array('', [
                    unnamedProperty(['int', 'tstr'])
                ]))
            ])
        ])

        expect(output).toContain('# empty array')
        expect(output).toContain('EmptyList = list[Any]')
        expect(output).toContain('ChoiceList = list[Union[int, str]]')
        expect(output).toContain('NestedList = list[Union[int, str]]')
    })

    it('should resolve inline groups, refs, tags and ranges into python types', () => {
        const output = transform([
            variable('tuple-type', group('', [
                unnamedProperty('int'),
                unnamedProperty('tstr')
            ]) as any),
            variable('choice-type', group('', [
                [unnamedProperty('int'), unnamedProperty('tstr')],
                unnamedProperty('bool')
            ]) as any),
            variable('dict-type', group('', [
                property('any', ['tstr'])
            ]) as any),
            variable('fallback-dict', group('', [
                property('foo', 'tstr')
            ]) as any),
            variable('group-array-type', {
                Type: 'group_array',
                Value: 'item-value',
                Unwrapped: false
            }),
            variable('mapped-tag-type', tagRef('tstr')),
            variable('custom-tag-type', tagRef('custom-tag')),
            variable('range-type', rangeRef()),
            variable('literal-null', literal(null))
        ])

        expect(output).toContain('TupleType = Tuple[int, str]')
        expect(output).toContain('ChoiceType = Union[Tuple[int, str], bool]')
        expect(output).toContain('DictType = dict[Any, str]')
        expect(output).toContain('FallbackDict = dict[str, Any]')
        expect(output).toContain('GroupArrayType = list[ItemValue]')
        expect(output).toContain('MappedTagType = str')
        expect(output).toContain('CustomTagType = CustomTag')
        expect(output).toContain('RangeType = int')
        expect(output).toContain('LiteralNull = None')
    })

    it('should render property defaults from both property and reference operators', () => {
        const output = transform([
            group('defaults', [
                property('count', 'int', {
                    Operator: { Type: 'default', Value: literal(7) }
                }),
                property('status', groupRef('status-value', {
                    Type: 'default',
                    Value: literal('ready')
                }), {
                    Comments: [comment('status docs')]
                }),
                property('maybe_enabled', 'bool', {
                    Occurrence: { n: 0, m: 1 },
                    Operator: { Type: 'default', Value: literal(false) }
                })
            ])
        ], { pydantic: true })

        expect(output).toContain('count: int = Field(default=7)')
        expect(output).toContain('status: StatusValue = Field(default="ready")  # status docs')
        expect(output).toContain('maybe_enabled: Optional[bool] = Field(default=False)')
    })

    it('should raise clear errors for unsupported transform inputs', () => {
        expect(() => transform([
            variable('unknown-native', 'nope')
        ])).toThrow('Unknown native type: "nope"')

        expect(() => transform([
            variable('unsupported-literal', literal({ foo: 'bar' }))
        ])).toThrow('Unsupported literal')

        expect(() => transform([
            variable('bad-group', { Type: 'group', Value: false, Unwrapped: false } as any)
        ])).toThrow('Unknown group type')

        expect(() => transform([
            variable('bad-reference', { Type: 'mystery', Value: 'oops', Unwrapped: false } as any)
        ])).toThrow('Unknown type')
    })
})
