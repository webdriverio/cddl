import url from 'node:url'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { parse, Type } from 'cddl'
import { transform } from '../src/index.js'
import type { Variable, Group, Array as CDDLArray } from 'cddl'
import { normalizeSnapshotOutput } from './snapshot.js'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

describe('transform', () => {
    describe('variables', () => {
        it('should transform a simple variable assignment', () => {
            const assignment: Variable = {
                Type: 'variable',
                Name: 'device-address',
                PropertyType: 'tstr',
                Comments: [],
                IsChoiceAddition: false
            }
            const output = transform([assignment])
            expect(output).toContain('public typealias DeviceAddress = String')
        })

        it.each([
            ['cbor', 'inner'],       // .cbor's argument matches a single decoded item - a map is fine
            ['cborseq', 'innerList'] // .cborseq's argument matches the sequence taken as an array (RFC 8610 §3.8.4)
        ] as const)('should ignore the .%s operator and still map bstr to [UInt8]', (operatorType, referencedType) => {
            // Either way this is a validation constraint on a byte string, not a structural
            // type change - same as every other operator (.size, .and, ...); the generator
            // never looks at what the reference resolves to.
            const assignment: Variable = {
                Type: 'variable',
                Name: 'payload',
                PropertyType: {
                    Type: 'bstr',
                    Operator: {
                        Type: operatorType,
                        Value: { Type: 'group', Value: referencedType, Unwrapped: false }
                    }
                } as any,
                Comments: [],
                IsChoiceAddition: false
            }
            const output = transform([assignment])
            expect(output).toContain('public typealias Payload = [UInt8]')
        })

        it('should transform a string literal union into a raw value enum', () => {
            const assignment: Variable = {
                Type: 'variable',
                Name: 'color',
                PropertyType: [
                    { Type: 'literal', Value: 'red' },
                    { Type: 'literal', Value: 'green' }
                ] as any,
                Comments: [],
                IsChoiceAddition: false
            }
            const output = transform([assignment])
            expect(output).toContain('public enum Color: String, Codable {')
            expect(output).toContain('case red = "red"')
            expect(output).toContain('case green = "green"')
        })

        it('should de-duplicate colliding enum case names', () => {
            const assignment: Variable = {
                Type: 'variable',
                Name: 'special',
                PropertyType: [
                    { Type: 'literal', Value: 'Infinity' },
                    { Type: 'literal', Value: '-Infinity' }
                ] as any,
                Comments: [],
                IsChoiceAddition: false
            }
            const output = transform([assignment])
            expect(output).toContain('case infinity = "Infinity"')
            expect(output).toContain('case infinity1 = "-Infinity"')
        })

        it('should transform a bare integer range variable into an Int typealias', () => {
            const assignment: Variable = {
                Type: 'variable',
                Name: 'byte-range',
                PropertyType: {
                    Type: { Type: 'range', Value: { Min: 0, Max: 255, Inclusive: true }, Unwrapped: false }
                } as any,
                Comments: [],
                IsChoiceAddition: false
            }
            const output = transform([assignment])
            expect(output).toContain('public typealias ByteRange = Int')
        })

        it('should transform a bare float range variable into a Double typealias', () => {
            const assignment: Variable = {
                Type: 'variable',
                Name: 'scale-range',
                PropertyType: {
                    // whole-valued float bound, shaped like the parser's actual literal node
                    Type: { Type: 'range', Value: { Min: { Type: 'literal', Value: 0, Unwrapped: false, IsFloat: true }, Max: 1, Inclusive: true }, Unwrapped: false }
                } as any,
                Comments: [],
                IsChoiceAddition: false
            }
            const output = transform([assignment])
            expect(output).toContain('public typealias ScaleRange = Double')
        })

        it('should transform union of group references into an enum', () => {
            const assignment: Variable = {
                Type: 'variable',
                Name: 'my-type',
                PropertyType: [
                    { Type: 'group', Value: 'Foo', Unwrapped: false },
                    { Type: 'group', Value: 'Bar', Unwrapped: false }
                ] as any,
                Comments: [],
                IsChoiceAddition: false
            }
            const output = transform([assignment])
            expect(output).toContain('public enum MyType {')
            expect(output).toContain('case foo(Foo)')
            expect(output).toContain('case bar(Bar)')
        })
    })

    describe('groups (struct)', () => {
        it('should resolve a bare (operator-less) float range property to Double', () => {
            // shape of a property like `quality: 0.0..1.0` (no operator) once parsed
            const assignment: Group = {
                Type: 'group',
                Name: 'image-format',
                IsChoiceAddition: false,
                Properties: [
                    {
                        HasCut: false,
                        Occurrence: { n: 1, m: 1 },
                        Name: 'quality',
                        Type: [{
                            Type: 'range',
                            Value: {
                                Inclusive: true,
                                Min: { Type: 'literal', Value: 0, Unwrapped: false, IsFloat: true },
                                Max: { Type: 'literal', Value: 1, Unwrapped: false, IsFloat: true }
                            },
                            Unwrapped: false
                        }],
                        Comments: []
                    }
                ] as any,
                Comments: []
            }
            const output = transform([assignment])
            expect(output).toContain('public var quality: Double')
        })

        it('should resolve an integer range property with an operator to Int, not always Double', () => {
            // shape of a property like `count: (0..10) .default 5` - a range WITH an
            // operator that is genuinely integer, not just the float `scale` example
            const assignment: Group = {
                Type: 'group',
                Name: 'counter',
                IsChoiceAddition: false,
                Properties: [
                    {
                        HasCut: false,
                        Occurrence: { n: 1, m: 1 },
                        Name: 'count',
                        Type: [{
                            Type: {
                                Type: 'range',
                                Value: {
                                    Inclusive: true,
                                    Min: { Type: 'literal', Value: 0, Unwrapped: false },
                                    Max: { Type: 'literal', Value: 10, Unwrapped: false }
                                },
                                Unwrapped: false
                            },
                            Operator: {
                                Type: 'default',
                                Value: { Type: 'literal', Value: 5, Unwrapped: false }
                            }
                        }],
                        Comments: []
                    }
                ] as any,
                Comments: []
            }
            const output = transform([assignment])
            expect(output).toContain('public var count: Int')
        })

        it('should transform a simple group into a struct', () => {
            const assignment: Group = {
                Type: 'group',
                Name: 'person',
                IsChoiceAddition: false,
                Properties: [
                    { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: 'age', Type: 'int', Comments: [] },
                    { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: 'name', Type: 'tstr', Comments: [] }
                ] as any,
                Comments: []
            }
            const output = transform([assignment])
            expect(output).toContain('public struct Person {')
            expect(output).toContain('public var age: Int')
            expect(output).toContain('public var name: String')
        })

        it('should mark optional fields with `?`', () => {
            const assignment: Group = {
                Type: 'group',
                Name: 'person',
                IsChoiceAddition: false,
                Properties: [
                    { HasCut: false, Occurrence: { n: 0, m: 1 }, Name: 'nickname', Type: 'tstr', Comments: [] },
                ] as any,
                Comments: []
            }
            const output = transform([assignment])
            expect(output).toContain('public var nickname: String?')
        })

        it('should escape Swift keywords used as field names', () => {
            const assignment: Group = {
                Type: 'group',
                Name: 'thing',
                IsChoiceAddition: false,
                Properties: [
                    { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: 'class', Type: 'tstr', Comments: [] },
                ] as any,
                Comments: []
            }
            const output = transform([assignment])
            expect(output).toContain('public var `class`: String')
        })

        it('should treat a quoted "null" as a String literal, not a nullable type', () => {
            const assignment: Group = {
                Type: 'group',
                Name: 'null-value',
                IsChoiceAddition: false,
                Properties: [
                    { HasCut: true, Occurrence: { n: 1, m: 1 }, Name: 'type', Type: [{ Type: 'literal', Value: 'null', Unwrapped: false }], Comments: [] },
                    { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: 'value', Type: ['tstr', 'null'], Comments: [] }
                ] as any,
                Comments: []
            }
            const output = transform([assignment])
            expect(output).toContain('public struct NullValue {')
            // quoted "null" is the string literal type
            expect(output).toContain('public var type: String')
            // a bare `null` in a union still makes the field optional
            expect(output).toContain('public var value: String?')
        })
    })

    describe('arrays', () => {
        it('should transform an array definition', () => {
            const assignment: CDDLArray = {
                Type: 'array',
                Name: 'my-list',
                Values: [
                    { HasCut: false, Occurrence: { n: 0, m: Infinity }, Name: '', Type: 'int', Comments: [] }
                ] as any,
                Comments: []
            }
            const output = transform([assignment])
            expect(output).toContain('public typealias MyList = [Int]')
        })

        it('should transform constrained choices, inline arrays, nested operators, and byte literals', () => {
            const output = transform([
                {
                    Type: 'array',
                    Name: 'choice-arr',
                    Values: [{
                        HasCut: false,
                        Occurrence: { n: 1, m: 1 },
                        Name: '',
                        Type: [
                            { Type: 'literal', Value: 0, Unwrapped: false },
                            { Type: ['int', 'tstr'], Operator: { Type: 'default', Value: { Type: 'literal', Value: 0, Unwrapped: false } } }
                        ],
                        Comments: []
                    }],
                    Comments: []
                },
                {
                    Type: 'variable',
                    Name: 'inline-arr',
                    IsChoiceAddition: false,
                    PropertyType: {
                        Type: {
                            Type: 'array',
                            Name: '',
                            Values: [{ HasCut: false, Occurrence: { n: 1, m: 1 }, Name: '', Type: 'int', Comments: [] }],
                            Comments: []
                        },
                        Operator: { Type: 'within', Value: { Type: 'group', Value: 'allowed', Unwrapped: false } }
                    },
                    Comments: []
                },
                {
                    Type: 'variable',
                    Name: 'nested-op',
                    IsChoiceAddition: false,
                    PropertyType: {
                        Type: { Type: Type.FLOAT, Operator: { Type: 'ge', Value: { Type: 'literal', Value: 0, Unwrapped: false, IsFloat: true } } },
                        Operator: { Type: 'default', Value: { Type: 'literal', Value: 1, Unwrapped: false, IsFloat: true } }
                    },
                    Comments: []
                },
                {
                    Type: 'variable',
                    Name: 'byte-lit',
                    IsChoiceAddition: false,
                    PropertyType: { Type: 'literal', Value: "h'0102'", Unwrapped: false, IsBytes: true },
                    Comments: []
                }
            ])
            expect(output).toContain('public typealias ChoiceArr = [Any]')
            expect(output).toContain('public typealias InlineArr = [Int]')
            expect(output).toContain('public typealias NestedOp = Double')
            expect(output).toContain('public typealias ByteLit = [UInt8]')
        })
    })

    describe('snapshot tests with parsed CDDL', () => {
        it('should transform test.cddl correctly', () => {
            const ast = parse(path.join(__dirname, '..', '..', '..', 'examples', 'commons', 'test.cddl'))
            const output = transform(ast)
            expect(normalizeSnapshotOutput(output)).toMatchSnapshot()
        })
    })
})
