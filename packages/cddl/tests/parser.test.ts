import url from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { describe, it, expect, vi } from 'vitest'

import Parser from '../src/parser.js'
import type { Group, Property, Array as CddlArray } from '../src/ast.js'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

describe('parser', () => {
    const testCases: { name: string, fixture: string }[] = [
        { name: 'should correctly parse CDDL file', fixture: 'example.cddl' },
        { name: 'can parse compositions', fixture: 'compositions.cddl' },
        { name: 'can parse ranges', fixture: 'ranges.cddl' },
        { name: 'can parse occurrences', fixture: 'occurrences.cddl' },
        { name: 'can parse arrays', fixture: 'arrays.cddl' },
        { name: 'can parse unwrapped arrays', fixture: 'unwrapping.cddl' },
        { name: 'can parse comments', fixture: 'comments.cddl' },
        { name: 'can parse choices', fixture: 'choices.cddl' },
        { name: 'can parse nested groups', fixture: 'nested.cddl' },
        { name: 'can parse operators', fixture: 'operators.cddl' }
    ]

    for (const { name, fixture } of testCases) {
        it(name, async () => {
            const p = new Parser(path.join(__dirname, '..', '..', '..', 'examples', 'commons', fixture))
            expect(p.parse()).toMatchSnapshot()
        })
    }

    it('parses the question-mark occurrence as zero-or-one', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('root = { ? optional: tstr, * repeated: tstr, + requiredRepeated: tstr }\n')
        const p = new Parser('foo.cddl')
        const [group] = p.parse() as Group[]
        const [optional, repeated, requiredRepeated] = group.Properties as Property[]

        expect(optional.Occurrence).toEqual({ n: 0, m: 1 })
        expect(repeated.Occurrence).toEqual({ n: 0, m: Infinity })
        expect(requiredRepeated.Occurrence).toEqual({ n: 1, m: Infinity })

        vi.restoreAllMocks()
    })

    it('throws if group identifier is missing', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('=')
        const p = new Parser('foo.cddl')
        expect(() => p.parse()).toThrow('group identifier expected')
        vi.restoreAllMocks()
    })

    it('throws if assignment operator is missing', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('groupName bar')
        const p = new Parser('foo.cddl')
        expect(() => p.parse()).toThrow('group identifier expected')
        vi.restoreAllMocks()
    })

    it('skips blank comment lines in assignment comments', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('; heading\n;\nfoo = int\n')
        const p = new Parser('foo.cddl')

        expect(p.parse()).toEqual([{
            Type: 'variable',
            Name: 'foo',
            IsChoiceAddition: false,
            PropertyType: ['int'],
            Comments: [{
                Type: 'comment',
                Content: 'heading',
                Leading: false
            }]
        }])

        vi.restoreAllMocks()
    })

    it('preserves float-ness of whole-valued float literals so (0.0..1.0) differs from (0..1)', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('root = {\n  float_range: (0.0..1.0),\n  int_range: (0..1),\n}\n')
        const p = new Parser('foo.cddl')
        const [group] = p.parse() as any[]

        const [floatRange, intRange] = group.Properties.map(
            (prop: any) => prop.Type[0].Type.Value
        )

        expect(floatRange.Min).toEqual({ Type: 'literal', Value: 0, Unwrapped: false, IsFloat: true })
        expect(floatRange.Max).toEqual({ Type: 'literal', Value: 1, Unwrapped: false, IsFloat: true })
        expect(intRange.Min).toEqual({ Type: 'literal', Value: 0, Unwrapped: false })
        expect(intRange.Max).toEqual({ Type: 'literal', Value: 1, Unwrapped: false })
        expect(intRange.Min.IsFloat).toBeUndefined()

        vi.restoreAllMocks()
    })

    it('parses RFC 9165 regexp operators on text strings', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('channel = tstr .regexp "custom:.+"\n')
        const p = new Parser('foo.cddl')

        expect(p.parse()).toEqual([{
            Type: 'variable',
            Name: 'channel',
            IsChoiceAddition: false,
            PropertyType: [{
                Type: 'tstr',
                Operator: {
                    Type: 'regexp',
                    Value: {
                        Type: 'literal',
                        Value: 'custom:.+',
                        Unwrapped: false
                    }
                }
            }],
            Comments: []
        }])

        vi.restoreAllMocks()
    })

    it('parses type choices with regexp operators on later members', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('channel = "values" / tstr .regexp "custom:.+"\n')
        const p = new Parser('foo.cddl')

        expect(p.parse()).toEqual([{
            Type: 'variable',
            Name: 'channel',
            IsChoiceAddition: false,
            PropertyType: [{
                Type: 'literal',
                Value: 'values',
                Unwrapped: false
            }, {
                Type: 'tstr',
                Operator: {
                    Type: 'regexp',
                    Value: {
                        Type: 'literal',
                        Value: 'custom:.+',
                        Unwrapped: false
                    }
                }
            }],
            Comments: []
        }])

        vi.restoreAllMocks()
    })

    it('parses quoted reserved words as string literals, not native types', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('Foo = { a: "null", b: "bool", c: "true", d: "false", e: "undefined" }\n')
        const p = new Parser('foo.cddl')

        const properties = (p.parse()[0] as Group).Properties as Property[]
        expect(properties.map((prop) => prop.Type)).toEqual([
            [{ Type: 'literal', Value: 'null', Unwrapped: false }],
            [{ Type: 'literal', Value: 'bool', Unwrapped: false }],
            [{ Type: 'literal', Value: 'true', Unwrapped: false }],
            [{ Type: 'literal', Value: 'false', Unwrapped: false }],
            [{ Type: 'literal', Value: 'undefined', Unwrapped: false }]
        ])

        vi.restoreAllMocks()
    })

    it('still parses bare reserved words as native types and booleans', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('Foo = { a: null, b: bool, c: true, d: false }\n')
        const p = new Parser('foo.cddl')

        const properties = (p.parse()[0] as Group).Properties as Property[]
        expect(properties.map((prop) => prop.Type)).toEqual([
            ['null'],
            ['bool'],
            [{ Type: 'literal', Value: true, Unwrapped: false }],
            [{ Type: 'literal', Value: false, Unwrapped: false }]
        ])

        vi.restoreAllMocks()
    })

    it('parses an operator on an unnamed member inside an array', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('envelope = [ bstr .size 3, bstr ]\n')
        const p = new Parser('foo.cddl')

        expect(() => p.parse()).not.toThrow()

        vi.restoreAllMocks()
    })

    it('produces the expected AST shape for an operator on an unnamed array member, including the second, undecorated member', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('envelope = [ bstr .size 3, bstr ]\n')
        const p = new Parser('foo.cddl')

        const values = (p.parse()[0] as CddlArray).Values as Property[]
        expect(values).toEqual([
            {
                HasCut: false,
                Occurrence: { n: 1, m: 1 },
                Name: '',
                Type: [{
                    Type: 'bstr',
                    Operator: {
                        Type: 'size',
                        Value: { Type: 'literal', Value: 3, Unwrapped: false }
                    }
                }],
                Comments: []
            },
            {
                HasCut: false,
                Occurrence: { n: 1, m: 1 },
                Name: '',
                Type: 'bstr',
                Comments: []
            }
        ])

        vi.restoreAllMocks()
    })

    it('parses an operator on a later, non-first unnamed array member', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('envelope = [ bstr, bstr .size 5 ]\n')
        const p = new Parser('foo.cddl')

        const values = (p.parse()[0] as CddlArray).Values as Property[]
        expect(values).toEqual([
            {
                HasCut: false,
                Occurrence: { n: 1, m: 1 },
                Name: '',
                Type: 'bstr',
                Comments: []
            },
            {
                HasCut: false,
                Occurrence: { n: 1, m: 1 },
                Name: '',
                Type: [{
                    Type: 'bstr',
                    Operator: {
                        Type: 'size',
                        Value: { Type: 'literal', Value: 5, Unwrapped: false }
                    }
                }],
                Comments: []
            }
        ])

        vi.restoreAllMocks()
    })

    it('parses a paren-wrapped single member with an operator, assigned directly to a name', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('ip4 = (bstr .size 4)\n')
        const p = new Parser('foo.cddl')

        expect(p.parse()).toEqual([{
            Type: 'variable',
            Name: 'ip4',
            IsChoiceAddition: false,
            PropertyType: {
                Type: 'bstr',
                Operator: {
                    Type: 'size',
                    Value: { Type: 'literal', Value: 4, Unwrapped: false }
                }
            },
            Comments: []
        }])

        vi.restoreAllMocks()
    })

    it('parses the .cbor operator on a map member, referencing another rule as the embedded type', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('inner = { a: int }\nouter = { ? parent: bstr .cbor inner }\n')
        const p = new Parser('foo.cddl')

        const [, outer] = p.parse() as Group[]
        expect(outer.Properties).toEqual([{
            HasCut: true,
            Occurrence: { n: 0, m: 1 },
            Name: 'parent',
            Type: [{
                Type: 'bstr',
                Operator: {
                    Type: 'cbor',
                    Value: { Type: 'group', Value: 'inner', Unwrapped: false }
                }
            }],
            Comments: []
        }])

        vi.restoreAllMocks()
    })

    it('parses the .cborseq operator the same way, on a required member', () => {
        // .cborseq's argument must be an array type (RFC 8610 §3.8.4: the decoded
        // sequence, taken as an array, is matched against it) - unlike .cbor's inner,
        // which matches a single decoded item and can legitimately be a map.
        vi.spyOn(fs, 'readFileSync').mockReturnValue('innerList = [int]\nouter = { payload: bstr .cborseq innerList }\n')
        const p = new Parser('foo.cddl')

        const [, outer] = p.parse() as Group[]
        expect(outer.Properties).toEqual([{
            HasCut: true,
            Occurrence: { n: 1, m: 1 },
            Name: 'payload',
            Type: [{
                Type: 'bstr',
                Operator: {
                    Type: 'cborseq',
                    Value: { Type: 'group', Value: 'innerList', Unwrapped: false }
                }
            }],
            Comments: []
        }])

        vi.restoreAllMocks()
    })

    it('parses numeric and byte-string literals as array entries (§3.4)', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue("block = [ 0, tstr, -1, 0x1.8p1, h'0102', 0 / 1, 0..10, * 0 ; trailing\n]\n")
        const p = new Parser('foo.cddl')

        const [arr] = p.parse() as CddlArray[]
        expect(arr.Type).toBe('array')
        expect(arr.Values).toEqual([
            { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: '', Type: [{ Type: 'literal', Value: 0, Unwrapped: false }], Comments: [] },
            { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: '', Type: 'tstr', Comments: [] },
            { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: '', Type: [{ Type: 'literal', Value: -1, Unwrapped: false }], Comments: [] },
            { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: '', Type: [{ Type: 'literal', Value: 3, Unwrapped: false, IsFloat: true }], Comments: [] },
            { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: '', Type: [{ Type: 'literal', Value: "h'0102'", Unwrapped: false, IsBytes: true }], Comments: [] },
            {
                HasCut: false,
                Occurrence: { n: 1, m: 1 },
                Name: '',
                Type: [
                    { Type: 'literal', Value: 0, Unwrapped: false },
                    { Type: 'literal', Value: 1, Unwrapped: false }
                ],
                Comments: []
            },
            {
                HasCut: false,
                Occurrence: { n: 1, m: 1 },
                Name: '',
                Type: [{
                    Type: 'range',
                    Value: {
                        Inclusive: true,
                        Min: { Type: 'literal', Value: 0, Unwrapped: false },
                        Max: { Type: 'literal', Value: 10, Unwrapped: false }
                    },
                    Unwrapped: false
                }],
                Comments: []
            },
            { HasCut: false, Occurrence: { n: 0, m: Infinity }, Name: '', Type: [{ Type: 'literal', Value: 0, Unwrapped: false }], Comments: [{ Type: 'comment', Content: 'trailing', Leading: false }] }
        ])

        vi.restoreAllMocks()
    })

    it('parses numeric and byte-string values as map member keys (§3.5.1)', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue("m = { 0 : int, ? -1 : tstr, h'0102' : bstr, 2 => uint, 3 ^ => bool }\n")
        const p = new Parser('foo.cddl')

        const [group] = p.parse() as Group[]
        expect(group.Properties).toEqual([
            { HasCut: true, Occurrence: { n: 1, m: 1 }, Name: '0', Type: ['int'], Comments: [] },
            { HasCut: true, Occurrence: { n: 0, m: 1 }, Name: '-1', Type: ['tstr'], Comments: [] },
            { HasCut: true, Occurrence: { n: 1, m: 1 }, Name: "h'0102'", Type: ['bstr'], Comments: [] },
            { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: '2', Type: ['uint'], Comments: [] },
            { HasCut: true, Occurrence: { n: 1, m: 1 }, Name: '3', Type: ['bool'], Comments: [] }
        ])

        vi.restoreAllMocks()
    })

    it('parses inclusive, exclusive, and symbolic ranges as member keys (§3.5.1)', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('m = { * 3 .. 255 => int, 0 ... 10 ^ => tstr, min .. max => any }\n')
        const p = new Parser('foo.cddl')

        const [group] = p.parse() as Group[]
        expect(group.Properties).toEqual([
            { HasCut: false, Occurrence: { n: 0, m: Infinity }, Name: '3..255', Type: ['int'], Comments: [] },
            { HasCut: true, Occurrence: { n: 1, m: 1 }, Name: '0...10', Type: ['tstr'], Comments: [] },
            { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: 'min..max', Type: ['any'], Comments: [] }
        ])

        vi.restoreAllMocks()
    })

    it('parses generic rule definitions and instantiations (§3.10)', () => {
        const src = [
            'pair<t> = [t, t]',
            'n = pair<int>',
            'entry<k, v> = { key: k, value: v }',
            'nested = entry<tstr, pair<int / tstr>>',
            'inline-arg = pair<{ a: int } / [tstr]>',
            'in-array = [ ~pair<int>, pair<tstr> ; item\n]',
            'ext<t> /= t',
        ].join('\n') + '\n'
        vi.spyOn(fs, 'readFileSync').mockReturnValue(src)
        const p = new Parser('foo.cddl')
        const ast = p.parse() as any[]

        expect(ast[0]).toMatchObject({ Type: 'array', Name: 'pair', GenericParameters: ['t'] })
        expect(ast[1]).toEqual({
            Type: 'variable',
            Name: 'n',
            IsChoiceAddition: false,
            PropertyType: [{
                Type: 'group',
                Value: 'pair',
                Unwrapped: false,
                GenericArguments: ['int']
            }],
            Comments: []
        })
        expect(ast[2]).toMatchObject({ Type: 'group', Name: 'entry', GenericParameters: ['k', 'v'] })
        expect(ast[3].PropertyType[0].GenericArguments).toEqual([
            'tstr',
            {
                Type: 'group',
                Value: 'pair',
                Unwrapped: false,
                GenericArguments: [['int', 'tstr']]
            }
        ])
        expect(ast[4].PropertyType[0].GenericArguments[0]).toHaveLength(2)
        expect(ast[5].Values[0].Type[0]).toEqual({
            Type: 'group',
            Value: 'pair',
            Unwrapped: true,
            GenericArguments: ['int']
        })
        expect(ast[6]).toMatchObject({ Type: 'variable', Name: 'ext', IsChoiceAddition: true, GenericParameters: ['t'] })

        vi.restoreAllMocks()
    })

    it('parses array entries with operators, inline choices, and multi-way group choices', () => {
        const src = [
            'with-op = [ 0 .default 1, 0 / 1 .default 2 ]',
            'with-inline-arr = [ 0 / [int] ]',
            'with-inline-map = [ 0 / { a: int }, 0 / (int / tstr) ]',
            'with-choice = ( 0 // 1 // 2 )',
            'with-choice-then-entry = ( 0 // 1, 2 )',
        ].join('\n') + '\n'
        vi.spyOn(fs, 'readFileSync').mockReturnValue(src)
        const p = new Parser('foo.cddl')
        const [withOp, withInlineArr, withInlineMap, withChoice, withChoiceThenEntry] = p.parse() as any[]

        expect(withOp.Values[0].Type[0]).toEqual({
            Type: { Type: 'literal', Value: 0, Unwrapped: false },
            Operator: { Type: 'default', Value: { Type: 'literal', Value: 1, Unwrapped: false } }
        })
        expect(withOp.Values[1].Type[1]).toEqual({
            Type: { Type: 'literal', Value: 1, Unwrapped: false },
            Operator: { Type: 'default', Value: { Type: 'literal', Value: 2, Unwrapped: false } }
        })
        expect(withInlineArr.Values).toHaveLength(1)
        expect(withInlineArr.Values[0].Type).toHaveLength(2)
        expect(withInlineArr.Values[0].Type[1].Type).toBe('array')
        expect(withInlineMap.Values).toHaveLength(2)
        expect(withInlineMap.Values[0].Type[1].Type).toBe('group')
        expect(withInlineMap.Values[1].Type).toHaveLength(3)
        expect(withChoice.Properties).toHaveLength(1)
        expect(withChoice.Properties[0]).toHaveLength(3)
        expect(withChoice.Properties[0].map((entry: any) => entry.Type[0].Value)).toEqual([0, 1, 2])
        expect(withChoiceThenEntry.Properties).toHaveLength(2)
        expect(withChoiceThenEntry.Properties[0]).toHaveLength(2)
        expect(withChoiceThenEntry.Properties[1].Type[0].Value).toBe(2)

        vi.restoreAllMocks()
    })

    it('allows comments inside generic parameter and argument lists', () => {
        const src = [
            'pair< ; lead',
            '  t, ; parameter',
            '  u ; end',
            '> = [t, u]',
            'n = pair< ; lead',
            '  int, ; argument',
            '  tstr ; end',
            '>',
        ].join('\n') + '\n'
        vi.spyOn(fs, 'readFileSync').mockReturnValue(src)
        const p = new Parser('foo.cddl')
        const [pair, n] = p.parse() as any[]

        expect(pair).toMatchObject({ Type: 'array', Name: 'pair', GenericParameters: ['t', 'u'] })
        expect(n.PropertyType[0]).toEqual({
            Type: 'group',
            Value: 'pair',
            Unwrapped: false,
            GenericArguments: ['int', 'tstr']
        })

        vi.restoreAllMocks()
    })

    it('throws clear errors on malformed generic parameter and argument lists', () => {
        for (const bad of ['foo<1> = int\n', 'foo<t bar> = int\n', 'foo<t> bar\n', 'x = pair<int tstr>\n']) {
            vi.spyOn(fs, 'readFileSync').mockReturnValue(bad)
            const p = new Parser('foo.cddl')
            expect(() => p.parse()).toThrow()
            vi.restoreAllMocks()
        }
    })

    it('parses hex float and byte string literals distinct from text strings (§3.1, Appendix B)', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue("f = 0x1.8p1\nb = h'0102'\nb64 = b64'AQID'\nraw = 'abc'\ntxt = \"h'0102'\"\n")
        const p = new Parser('foo.cddl')

        expect(p.parse()).toEqual([
            {
                Type: 'variable',
                Name: 'f',
                IsChoiceAddition: false,
                PropertyType: [{ Type: 'literal', Value: 3, Unwrapped: false, IsFloat: true }],
                Comments: []
            },
            {
                Type: 'variable',
                Name: 'b',
                IsChoiceAddition: false,
                PropertyType: [{ Type: 'literal', Value: "h'0102'", Unwrapped: false, IsBytes: true }],
                Comments: []
            },
            {
                Type: 'variable',
                Name: 'b64',
                IsChoiceAddition: false,
                PropertyType: [{ Type: 'literal', Value: "b64'AQID'", Unwrapped: false, IsBytes: true }],
                Comments: []
            },
            {
                Type: 'variable',
                Name: 'raw',
                IsChoiceAddition: false,
                PropertyType: [{ Type: 'literal', Value: "'abc'", Unwrapped: false, IsBytes: true }],
                Comments: []
            },
            {
                Type: 'variable',
                Name: 'txt',
                IsChoiceAddition: false,
                PropertyType: [{ Type: 'literal', Value: "h'0102'", Unwrapped: false }],
                Comments: []
            }
        ])

        vi.restoreAllMocks()
    })
})
