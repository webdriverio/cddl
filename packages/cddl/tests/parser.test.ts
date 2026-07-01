import url from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { describe, it, expect, vi } from 'vitest'

import Parser from '../src/parser.js'
import type { Group, Property } from '../src/ast.js'

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
})
