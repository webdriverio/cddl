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
            expect(output).toContain('DeviceAddress = str')
        })

        it('should transform union variable', () => {
            const assignment: Variable = {
                Type: 'variable',
                Name: 'my-type',
                PropertyType: ['int', 'tstr'],
                Comments: [],
                IsChoiceAddition: false
            }
            const output = transform([assignment])
            expect(output).toContain('MyType = Union[int, str]')
        })

        it('should transform bigint literals', () => {
            const assignment: Variable = {
                Type: 'variable',
                Name: 'MyBigInt',
                PropertyType: {
                    Type: 'literal',
                    Value: 9007199254740995n
                } as any,
                Comments: [],
                IsChoiceAddition: false
            }
            const output = transform([assignment])
            expect(output).toContain('MyBigInt = Literal[9007199254740995]')
        })
    })

    describe('groups (TypedDict)', () => {
        it('should transform a simple group into a TypedDict', () => {
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
            expect(output).toContain('class Person(TypedDict):')
            expect(output).toContain('    age: int')
            expect(output).toContain('    name: str')
        })

        it('should handle optional fields with NotRequired', () => {
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
            expect(output).toContain('class Person(TypedDict):')
            expect(output).toContain('    nickname: NotRequired[str]')
        })
    })

    describe('groups (Pydantic)', () => {
        it('should transform a simple group into a Pydantic BaseModel', () => {
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
            const output = transform([assignment], { pydantic: true })
            expect(output).toContain('from pydantic import BaseModel')
            expect(output).toContain('class Person(BaseModel):')
            expect(output).toContain('    age: int')
            expect(output).toContain('    name: str')
        })

        it('should handle optional fields with Optional and None default', () => {
            const assignment: Group = {
                Type: 'group',
                Name: 'person',
                IsChoiceAddition: false,
                Properties: [
                    { HasCut: false, Occurrence: { n: 0, m: 1 }, Name: 'nickname', Type: 'tstr', Comments: [] },
                ] as any,
                Comments: []
            }
            const output = transform([assignment], { pydantic: true })
            expect(output).toContain('class Person(BaseModel):')
            expect(output).toContain('    nickname: Optional[str] = None')
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
            expect(output).toContain('MyList = list[int]')
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
                    Type: 'array',
                    Name: 'inline-arr',
                    Values: [{
                        HasCut: false,
                        Occurrence: { n: 1, m: 1 },
                        Name: '',
                        Type: [
                            { Type: 'literal', Value: 0, Unwrapped: false },
                            {
                                Type: {
                                    Type: 'array',
                                    Name: '',
                                    Values: [{ HasCut: false, Occurrence: { n: 1, m: 1 }, Name: '', Type: 'int', Comments: [] }],
                                    Comments: []
                                },
                                Operator: { Type: 'within', Value: { Type: 'group', Value: 'allowed', Unwrapped: false } }
                            }
                        ],
                        Comments: []
                    }],
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
            expect(output).toContain('ChoiceArr = list[Union[Literal[0], Union[int, str]]]')
            expect(output).toContain('InlineArr = list[Union[Literal[0], list[int]]]')
            expect(output).toContain('NestedOp = float')
            expect(output).toContain('ByteLit = bytes')
        })
    })

    describe('snapshot tests with parsed CDDL', () => {
        it('should transform test.cddl TypedDict correctly', () => {
            const ast = parse(path.join(__dirname, '..', '..', '..', 'examples', 'commons', 'test.cddl'))
            const output = transform(ast)
            expect(normalizeSnapshotOutput(output)).toMatchSnapshot()
        })

        it('should transform test.cddl Pydantic correctly', () => {
            const ast = parse(path.join(__dirname, '..', '..', '..', 'examples', 'commons', 'test.cddl'))
            const output = transform(ast, { pydantic: true })
            expect(normalizeSnapshotOutput(output)).toMatchSnapshot()
        })
    })
})
