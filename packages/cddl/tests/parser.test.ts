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

    it('parses numeric, hex float, byte string, and range literals as array entries', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(
            'block = [ 0, tstr ]\n' +
            'extras = [ 0x1.8p1, h\'0102\', 1..3, 0 / ; comment\n 1, * 3, 1*3 0, ~pair<int> ]\n' +
            'midOp = [ tstr, bstr .size 3, tstr ]\n' +
            'commented = [ 0 ; zero\n]\n'
        )
        const p = new Parser('foo.cddl')

        const [block, extras, midOp, commented] = p.parse() as CddlArray[]
        expect(midOp.Values).toHaveLength(3)
        expect(block.Values).toEqual([
            {
                HasCut: false,
                Occurrence: { n: 1, m: 1 },
                Name: '',
                Type: [{ Type: 'literal', Value: 0, Unwrapped: false }],
                Comments: []
            },
            {
                HasCut: false,
                Occurrence: { n: 1, m: 1 },
                Name: '',
                Type: 'tstr',
                Comments: []
            }
        ])

        expect(extras.Values).toEqual([
            {
                HasCut: false,
                Occurrence: { n: 1, m: 1 },
                Name: '',
                Type: [{ Type: 'literal', Value: 3, Unwrapped: false, IsFloat: true }],
                Comments: []
            },
            {
                HasCut: false,
                Occurrence: { n: 1, m: 1 },
                Name: '',
                Type: [{
                    Type: 'literal',
                    Value: '0102',
                    Unwrapped: false,
                    IsByteString: true,
                    ByteEncoding: 'hex'
                }],
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
                        Min: { Type: 'literal', Value: 1, Unwrapped: false },
                        Max: { Type: 'literal', Value: 3, Unwrapped: false }
                    },
                    Unwrapped: false
                }],
                Comments: []
            },
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
                Occurrence: { n: 0, m: Infinity },
                Name: '',
                Type: [{ Type: 'literal', Value: 3, Unwrapped: false }],
                Comments: []
            },
            {
                HasCut: false,
                Occurrence: { n: 1, m: 3 },
                Name: '',
                Type: [{ Type: 'literal', Value: 0, Unwrapped: false }],
                Comments: []
            },
            {
                HasCut: false,
                Occurrence: { n: 1, m: 1 },
                Name: '',
                Type: [{ Type: 'group', Value: 'pair', Unwrapped: true, GenericArguments: ['int'] }],
                Comments: []
            }
        ])

        expect((commented.Values[0] as Property).Comments).toEqual([{
            Type: 'comment',
            Content: 'zero',
            Leading: false
        }])

        vi.restoreAllMocks()
    })

    it('parses numeric, byte string, range, generic, and operator map keys', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(
            'm1 = { 0 : int, -1 => tstr, h\'0102\' : bool }\n' +
            'm2 = { * 3 .. 255 => int, * 0...10 ^ => tstr }\n' +
            'm3 = { * pair<tstr .regexp ".*", 0> => any, * #6.32(tstr) => int, * bstr .size 3 => int, * min-k .. max-k => bool, * [int] => tstr, * { a: int } => bool }\n' +
            'choices = ( pair<int> // pair<tstr> )\n' +
            'choicesWithNext = ( pair<int> // pair<tstr>, x: int )\n' +
            'legacyChoiceWithNext = ( attire // attireBlock, x: int )\n'
        )
        const p = new Parser('foo.cddl')

        const [m1, m2, m3, choices, choicesWithNext, legacyChoiceWithNext] = p.parse() as Group[]
        expect(m1.Properties).toEqual([
            {
                HasCut: true,
                Occurrence: { n: 1, m: 1 },
                Name: '0',
                KeyType: { Type: 'literal', Value: 0, Unwrapped: false },
                Type: ['int'],
                Comments: []
            },
            {
                HasCut: false,
                Occurrence: { n: 1, m: 1 },
                Name: '-1',
                KeyType: { Type: 'literal', Value: -1, Unwrapped: false },
                Type: ['tstr'],
                Comments: []
            },
            {
                HasCut: true,
                Occurrence: { n: 1, m: 1 },
                Name: "h'0102'",
                KeyType: { Type: 'literal', Value: '0102', Unwrapped: false, IsByteString: true, ByteEncoding: 'hex' },
                Type: ['bool'],
                Comments: []
            }
        ])

        expect(m2.Properties).toEqual([
            {
                HasCut: false,
                Occurrence: { n: 0, m: Infinity },
                Name: '3..255',
                KeyType: {
                    Type: 'range',
                    Value: {
                        Inclusive: true,
                        Min: { Type: 'literal', Value: 3, Unwrapped: false },
                        Max: { Type: 'literal', Value: 255, Unwrapped: false }
                    },
                    Unwrapped: false
                },
                Type: ['int'],
                Comments: []
            },
            {
                HasCut: true,
                Occurrence: { n: 0, m: Infinity },
                Name: '0...10',
                KeyType: {
                    Type: 'range',
                    Value: {
                        Inclusive: false,
                        Min: { Type: 'literal', Value: 0, Unwrapped: false },
                        Max: { Type: 'literal', Value: 10, Unwrapped: false }
                    },
                    Unwrapped: false
                },
                Type: ['tstr'],
                Comments: []
            }
        ])

        expect((m3.Properties as Property[]).map((prop) => prop.Name)).toEqual([
            'pair<tstr .regexp .*, 0>',
            '#6.32(tstr)',
            'bstr .size 3',
            'min-k..max-k',
            '[...]',
            '{...}'
        ])
        expect((m3.Properties[2] as Property).KeyType).toEqual({
            Type: 'bstr',
            Operator: {
                Type: 'size',
                Value: { Type: 'literal', Value: 3, Unwrapped: false }
            }
        })

        expect(choices.Properties).toHaveLength(1)
        expect(choices.Properties[0]).toHaveLength(2)
        expect(choicesWithNext.Properties).toHaveLength(2)
        expect(choicesWithNext.Properties[0]).toHaveLength(2)
        expect((choicesWithNext.Properties[1] as Property).Name).toBe('x')
        expect((legacyChoiceWithNext.Properties[2] as Property).Name).toBe('x')

        vi.restoreAllMocks()
    })

    it('parses generic rule definitions and generic type applications', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(
            'pair<t> = [t, t]\n' +
            'map<k, v> = { * k => v }\n' +
            'choice<a, b> = a / b\n' +
            'n = pair<int>\n' +
            'm = map<tstr, int>\n' +
            'nested = pair<pair<int .gt 0>>\n'
        )
        const p = new Parser('foo.cddl')

        expect(p.parse()).toEqual([
            {
                Type: 'array',
                Name: 'pair',
                GenericParameters: ['t'],
                Values: [
                    { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: '', Type: [{ Type: 'group', Value: 't', Unwrapped: false }], Comments: [] },
                    { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: '', Type: [{ Type: 'group', Value: 't', Unwrapped: false }], Comments: [] }
                ],
                Comments: []
            },
            {
                Type: 'group',
                Name: 'map',
                GenericParameters: ['k', 'v'],
                IsChoiceAddition: false,
                Properties: [
                    { HasCut: false, Occurrence: { n: 0, m: Infinity }, Name: 'k', Type: [{ Type: 'group', Value: 'v', Unwrapped: false }], Comments: [] }
                ],
                Comments: []
            },
            {
                Type: 'variable',
                Name: 'choice',
                GenericParameters: ['a', 'b'],
                IsChoiceAddition: false,
                PropertyType: [
                    { Type: 'group', Value: 'a', Unwrapped: false },
                    { Type: 'group', Value: 'b', Unwrapped: false }
                ],
                Comments: []
            },
            {
                Type: 'variable',
                Name: 'n',
                IsChoiceAddition: false,
                PropertyType: [{ Type: 'group', Value: 'pair', Unwrapped: false, GenericArguments: ['int'] }],
                Comments: []
            },
            {
                Type: 'variable',
                Name: 'm',
                IsChoiceAddition: false,
                PropertyType: [{ Type: 'group', Value: 'map', Unwrapped: false, GenericArguments: ['tstr', 'int'] }],
                Comments: []
            },
            {
                Type: 'variable',
                Name: 'nested',
                IsChoiceAddition: false,
                PropertyType: [{
                    Type: 'group',
                    Value: 'pair',
                    Unwrapped: false,
                    GenericArguments: [{
                        Type: 'group',
                        Value: 'pair',
                        Unwrapped: false,
                        GenericArguments: [{
                            Type: 'int',
                            Operator: {
                                Type: 'gt',
                                Value: { Type: 'literal', Value: 0, Unwrapped: false }
                            }
                        }]
                    }]
                }],
                Comments: []
            }
        ])

        vi.restoreAllMocks()
    })

    it('parses hex floats and RFC 8610 byte string literals in variables', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('f = 0x1.8p1\nf2 = 0x1.0p0..0x2.0p0\nb = h\'0102\'\nb2 = b64\'AQID\'\n')
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
                Name: 'f2',
                IsChoiceAddition: false,
                PropertyType: [{
                    Type: 'range',
                    Value: {
                        Inclusive: true,
                        Min: { Type: 'literal', Value: 1, Unwrapped: false, IsFloat: true },
                        Max: { Type: 'literal', Value: 2, Unwrapped: false, IsFloat: true }
                    },
                    Unwrapped: false
                }],
                Comments: []
            },
            {
                Type: 'variable',
                Name: 'b',
                IsChoiceAddition: false,
                PropertyType: [{
                    Type: 'literal',
                    Value: '0102',
                    Unwrapped: false,
                    IsByteString: true,
                    ByteEncoding: 'hex'
                }],
                Comments: []
            },
            {
                Type: 'variable',
                Name: 'b2',
                IsChoiceAddition: false,
                PropertyType: [{
                    Type: 'literal',
                    Value: 'AQID',
                    Unwrapped: false,
                    IsByteString: true,
                    ByteEncoding: 'b64'
                }],
                Comments: []
            }
        ])

        vi.restoreAllMocks()
    })

    it('parses inline arrays/maps, raw byte strings, and comments inside generic lists', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue(
            'box< ; param comment\n' +
            '  t ; trailing\n' +
            '> = [t]\n' +
            'inlineArr = box<[int]>\n' +
            'inlineMap = box<{ a: tstr }>\n' +
            'commentedArgs = map< ; open\n' +
            '  tstr ; key\n' +
            '  , ; sep\n' +
            '  int ; val\n' +
            '>\n' +
            'rawBytes = \'hello\'\n' +
            'textBytes = "h\'0102\'"\n'
        )
        const p = new Parser('foo.cddl')

        const [box, inlineArr, inlineMap, commentedArgs, rawBytes, textBytes] = p.parse() as any[]
        expect(box.GenericParameters).toEqual(['t'])
        expect(inlineArr.PropertyType[0].GenericArguments[0].Type).toBe('array')
        expect(inlineMap.PropertyType[0].GenericArguments[0].Type).toBe('group')
        expect(commentedArgs.PropertyType[0].GenericArguments).toEqual(['tstr', 'int'])
        expect(rawBytes.PropertyType[0]).toEqual({
            Type: 'literal',
            Value: 'hello',
            Unwrapped: false,
            IsByteString: true,
            ByteEncoding: 'utf8'
        })
        expect(textBytes.PropertyType[0]).toEqual({
            Type: 'literal',
            Value: "h'0102'",
            Unwrapped: false
        })

        vi.restoreAllMocks()
    })

    it('throws on malformed generic rule parameters or arguments', () => {
        for (const [cddl, expected] of [
            ['pair<> = int\n', 'Expected generic parameter identifier'],
            ['pair<t = int\n', 'Expected ">" to close generic parameter list'],
            ['pair<t> bar\n', 'Expected "=" after "pair"'],
            ['n = pair<int\n', 'Expected ">" to close generic argument list']
        ]) {
            vi.spyOn(fs, 'readFileSync').mockReturnValue(cddl)
            expect(() => new Parser('foo.cddl').parse()).toThrow(expected)
            vi.restoreAllMocks()
        }
    })
})
