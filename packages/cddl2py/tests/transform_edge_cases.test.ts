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
        expect(output).toContain('GroupArrayType = list["ItemValue"]')
        expect(output).toContain('MappedTagType = str')
        expect(output).toContain('CustomTagType = "CustomTag"')
        expect(output).toContain('RangeType = int')
        expect(output).toContain('LiteralNull = None')
    })

    it('should quote unresolved forward references in top-level aliases', () => {
        const output = transform([
            variable('content-block', [
                groupRef('text-block'),
                groupRef('reasoning-block')
            ]),
            variable('annotation', [
                groupRef('citation'),
                groupRef('content-block')
            ]),
            group('text-block', [property('text', 'tstr')]),
            group('reasoning-block', [property('reasoning', 'tstr')]),
            group('citation', [property('url', 'tstr')])
        ])

        expect(output).toContain('ContentBlock = Union["TextBlock", "ReasoningBlock"]')
        expect(output).toContain('Annotation = Union["Citation", ContentBlock]')
    })

    it('should emit hard mixin dependencies before dependent classes', () => {
        const output = transform([
            group('base-record', [property('id', 'uint')]),
            variable('base-alias', {
                Type: 'group',
                Value: 'base-record',
                Unwrapped: false
            }),
            group('command-response', [
                unnamedProperty(groupRef('base-alias')),
                property('id', 'uint')
            ])
        ])

        expect(output.indexOf('class BaseRecord(TypedDict):')).toBeLessThan(output.indexOf('class CommandResponse(BaseRecord):'))
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

    it('should cover direct type-resolution edge cases', () => {
        const output = transform([
            variable('direct-range', {
                Type: {
                    Type: 'range',
                    Value: {
                        Min: 0,
                        Max: 5,
                        Inclusive: true
                    },
                    Unwrapped: false
                }
            } as any),
            variable('mapped-any-wrapper', { Type: 'any' } as any),
            variable('operator-any-wrapper', {
                Type: { Type: 'any' },
                Operator: { Type: 'default', Value: literal(true) }
            } as any),
            variable('single-choice-inline', group('', [
                [unnamedProperty('int')]
            ]) as any),
            variable('empty-inline-array', array('', []) as any),
            variable('tag-any-type', tagRef('any')),
            group('dict-any', [property('any', 'tstr')]),
            group('unsupported-default', [
                property('status', groupRef('status-value', {
                    Type: 'default',
                    Value: groupRef('fallback-value')
                }))
            ])
        ], { pydantic: true })

        expect(output).toContain('DirectRange = int')
        expect(output).toContain('MappedAnyWrapper = Any')
        expect(output).toContain('OperatorAnyWrapper = Any')
        expect(output).toContain('SingleChoiceInline = int')
        expect(output).toContain('EmptyInlineArray = list[Any]')
        expect(output).toContain('TagAnyType = Any')
        expect(output).toContain('DictAny = dict[Any, str]')
        expect(output).toContain('status: StatusValue')
        expect(output).not.toContain('Field(default=fallback')
    })

    it('should cover array and group-choice single-branch paths', () => {
        const output = transform([
            group('named-choice-tail', [
                unnamedProperty(groupRef('left')),
                [unnamedProperty('bool')]
            ]),
            group('inline-union-head', [
                unnamedProperty(['int', 'tstr']),
                [unnamedProperty('bool')]
            ]),
            array('single-choice-array', [[unnamedProperty('int')]]),
            array('single-nested-array', [
                unnamedProperty(array('', [unnamedProperty('int')]))
            ]),
            array('multi-direct-array', [
                unnamedProperty(['int', 'tstr'])
            ])
        ])

        expect(output).toContain('NamedChoiceTail = Union[Left, bool]')
        expect(output).toContain('InlineUnionHead = Union[int, str, bool]')
        expect(output).toContain('SingleChoiceArray = list[int]')
        expect(output).toContain('SingleNestedArray = list[int]')
        expect(output).toContain('MultiDirectArray = list[Union[int, str]]')
    })

    it('should filter incompatible mixins while expanding supported aliases', () => {
        const output = transform([
            group('base', [property('id', 'uint')]),
            group('other-base', [property('name', 'tstr')]),
            group('extra-base', [property('kind', 'tstr')]),
            array('array-base', [unnamedProperty('int')]),
            group('choice-base', [[unnamedProperty('int'), unnamedProperty('tstr')]]),
            variable('union-alias', [groupRef('base'), groupRef('other-base')]),
            variable('native-alias', 'tstr'),
            group('with-operator-base', [
                unnamedProperty({
                    Type: groupRef('extra-base'),
                    Operator: { Type: 'default', Value: literal(true) }
                } as any),
                property('flag', 'bool')
            ]),
            group('expanded-union-alias', [
                unnamedProperty(groupRef('union-alias')),
                property('flag', 'bool')
            ]),
            group('filtered-mixins', [
                unnamedProperty(groupRef('native-alias')),
                unnamedProperty(groupRef('array-base')),
                unnamedProperty(groupRef('missing-base')),
                unnamedProperty(groupRef('choice-base')),
                property('flag', 'bool')
            ])
        ])

        expect(output).toContain('class WithOperatorBase(ExtraBase):')
        expect(output).toContain('class _ExpandedUnionAliasFields(TypedDict):')
        expect(output).toContain('class _ExpandedUnionAliasVariant0(_ExpandedUnionAliasFields, Base):')
        expect(output).toContain('class _ExpandedUnionAliasVariant1(_ExpandedUnionAliasFields, OtherBase):')
        expect(output).toContain('ExpandedUnionAlias = Union[_ExpandedUnionAliasVariant0, _ExpandedUnionAliasVariant1]')
        expect(output).toContain('class _FilteredMixinsFields(TypedDict):')
        expect(output).toContain('class _FilteredMixinsVariant0(_FilteredMixinsFields):')
        expect(output).toContain('class _FilteredMixinsVariant1(_FilteredMixinsFields):')
        expect(output).not.toContain('MissingBase')
        expect(output).not.toContain('class _FilteredMixinsVariant0(_FilteredMixinsFields, NativeAlias')
        expect(output).not.toContain('class _FilteredMixinsVariant0(_FilteredMixinsFields, ArrayBase')
    })

    it('should expand late-defined union aliases used as mixins', () => {
        const output = transform([
            group('base', [property('id', 'uint')]),
            group('other-base', [property('name', 'tstr')]),
            group('late-union-consumer', [
                unnamedProperty(groupRef('late-union-alias')),
                property('flag', 'bool')
            ]),
            variable('late-union-alias', [groupRef('base'), groupRef('other-base')])
        ])

        expect(output).toContain('class _LateUnionConsumerFields(TypedDict):')
        expect(output).toContain('class _LateUnionConsumerVariant0(_LateUnionConsumerFields, Base):')
        expect(output).toContain('class _LateUnionConsumerVariant1(_LateUnionConsumerFields, OtherBase):')
        expect(output).toContain('LateUnionConsumer = Union[_LateUnionConsumerVariant0, _LateUnionConsumerVariant1]')
    })

    it('should fall back safely for unknown assignment shapes', () => {
        const output = transform([
            { Type: 'mystery', Name: 'ghost' } as any
        ])

        expect(output).toContain('from __future__ import annotations')
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

    it('should ignore malformed comment entries when rendering comments', () => {
        const output = transform([
            variable('commented', 'tstr', [
                comment('leading docs', true),
                null as any
            ])
        ])

        expect(output).toContain('# leading docs')
        expect(output).toContain('Commented = str')
    })
})
