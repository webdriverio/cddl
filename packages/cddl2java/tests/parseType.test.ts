import { describe, it, expect } from 'vitest'

import { parseType } from '../src/index.js'

// Shapes mirror what the `cddl` parser actually emits for a range property, extracted by
// parsing `quality: 0.0..1.0` (no operator) and `twist: 0..359 .default 0` (with operator)
// directly - see packages/cddl/tests/parser.test.ts and packages/cddl2java/tests/bidi.cddl.

describe('parseType', () => {
    describe('range without an operator', () => {
        it('resolves a float range (IsFloat marker) to Float', () => {
            const specType = [
                {
                    Type: 'range',
                    Value: {
                        Inclusive: true,
                        Min: { Type: 'literal', Value: 0, Unwrapped: false, IsFloat: true },
                        Max: { Type: 'literal', Value: 1, Unwrapped: false, IsFloat: true }
                    },
                    Unwrapped: false
                }
            ]
            expect(parseType(specType)).toEqual({ type: 'Float', isLiteral: false })
        })

        it('resolves a plain integer range to Integer', () => {
            const specType = [
                {
                    Type: 'range',
                    Value: {
                        Inclusive: true,
                        Min: { Type: 'literal', Value: 0, Unwrapped: false },
                        Max: { Type: 'literal', Value: 100, Unwrapped: false }
                    },
                    Unwrapped: false
                }
            ]
            expect(parseType(specType)).toEqual({ type: 'Integer', isLiteral: false })
        })
    })

    describe('range with an operator (e.g. .default)', () => {
        it('resolves a float range to Float', () => {
            const specType = [
                {
                    Type: {
                        Type: 'range',
                        Value: {
                            Inclusive: true,
                            Min: { Type: 'literal', Value: 0, Unwrapped: false, IsFloat: true },
                            Max: { Type: 'literal', Value: 1, Unwrapped: false, IsFloat: true }
                        },
                        Unwrapped: false
                    },
                    Operator: {
                        Type: 'default',
                        Value: { Type: 'literal', Value: 0, Unwrapped: false }
                    }
                }
            ]
            expect(parseType(specType)).toEqual({ type: 'Float', isLiteral: false })
        })

        it('resolves a plain integer range to Integer, not always Float', () => {
            // this is the exact shape of `twist: 0..359 .default 0` in bidi.cddl -
            // before the fix, this branch always returned Float regardless of the range
            const specType = [
                {
                    Type: {
                        Type: 'range',
                        Value: {
                            Inclusive: true,
                            Min: { Type: 'literal', Value: 0, Unwrapped: false },
                            Max: { Type: 'literal', Value: 359, Unwrapped: false }
                        },
                        Unwrapped: false
                    },
                    Operator: {
                        Type: 'default',
                        Value: { Type: 'literal', Value: 0, Unwrapped: false }
                    }
                }
            ]
            expect(parseType(specType)).toEqual({ type: 'Integer', isLiteral: false })
        })
    })

    describe('byte strings', () => {
        it('resolves bare bstr/bytes to byte[]', () => {
            // was "Unknown" before the fix - bstr/bytes had no primitive-type mapping at all
            expect(parseType(['bstr'])).toEqual({ type: 'byte[]', isLiteral: false })
            expect(parseType(['bytes'])).toEqual({ type: 'byte[]', isLiteral: false })
        })

        it('resolves a bstr with an unrecognized operator by ignoring the operator, not throwing', () => {
            // .cbor/.cborseq (RFC 8610 §3.8.4) are validation constraints on a byte string,
            // not a structural type change - same as every other generator already treats
            // .size/.and/.within/etc. Before the fix this threw "Unknown operator". The
            // generator never looks at what the reference resolves to, but the names below
            // still follow the RFC: .cbor's argument matches a single decoded item (a map
            // is fine), .cborseq's matches the sequence taken as an array.
            const cborSpecType = [{
                Type: 'bstr',
                Operator: {
                    Type: 'cbor',
                    Value: { Type: 'group', Value: 'inner', Unwrapped: false }
                }
            }]
            expect(parseType(cborSpecType)).toEqual({ type: 'byte[]', isLiteral: false })

            const cborseqSpecType = [{
                Type: 'bstr',
                Operator: {
                    Type: 'cborseq',
                    Value: { Type: 'group', Value: 'innerList', Unwrapped: false }
                }
            }]
            expect(parseType(cborseqSpecType)).toEqual({ type: 'byte[]', isLiteral: false })
        })

        it('resolves byte-string literals and operator-wrapped choices, arrays, and nested operators', () => {
            expect(parseType([{ Type: 'literal', Value: "h'0102'", Unwrapped: false, IsBytes: true }])).toEqual({
                type: 'byte[]',
                isLiteral: false
            })
            expect(parseType([{
                Type: ['int', 'tstr'],
                Operator: { Type: 'default', Value: { Type: 'literal', Value: 0, Unwrapped: false } }
            }])).toEqual({ type: 'Object', isLiteral: false })
            expect(parseType([{
                Type: {
                    Type: 'array',
                    Name: '',
                    Values: [{
                        HasCut: false,
                        Occurrence: { n: 1, m: 1 },
                        Name: '',
                        Type: [{ Type: 'group', Value: 'session.Subscription', Unwrapped: false }],
                        Comments: []
                    }],
                    Comments: []
                },
                Operator: { Type: 'within', Value: { Type: 'group', Value: 'allowed', Unwrapped: false } }
            }])).toEqual({ type: 'List<String>', isLiteral: false })
            expect(parseType([{
                Type: {
                    Type: 'float',
                    Operator: { Type: 'ge', Value: { Type: 'literal', Value: 0, Unwrapped: false, IsFloat: true } }
                },
                Operator: { Type: 'default', Value: { Type: 'literal', Value: 1, Unwrapped: false, IsFloat: true } }
            }])).toEqual({ type: 'Float', isLiteral: false })
        })
    })
})
