import url from 'node:url'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { parse } from 'cddl'
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
            expect(output).toContain('typealias DeviceAddress = String')
        })

        it('should transform a string literal union into an enum class', () => {
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
            expect(output).toContain('enum class Color(val value: String) {')
            expect(output).toContain('RED("red"),')
            expect(output).toContain('GREEN("green");')
        })

        it('should de-duplicate colliding enum constant names', () => {
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
            expect(output).toContain('INFINITY("Infinity"),')
            expect(output).toContain('INFINITY1("-Infinity");')
        })

        it('should transform union of group references into a sealed interface', () => {
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
            expect(output).toContain('sealed interface MyType {')
            expect(output).toContain('data class FooValue(val value: Foo) : MyType')
            expect(output).toContain('data class BarValue(val value: Bar) : MyType')
        })
    })

    describe('groups (data class)', () => {
        it('should transform a simple group into a data class', () => {
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
            expect(output).toContain('data class Person(')
            expect(output).toContain('val age: Int,')
            expect(output).toContain('val name: String')
        })

        it('should mark optional fields as nullable with a default', () => {
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
            expect(output).toContain('val nickname: String? = null')
        })

        it('should generate a plain class for empty groups', () => {
            const assignment: Group = {
                Type: 'group',
                Name: 'empty',
                IsChoiceAddition: false,
                Properties: [] as any,
                Comments: []
            }
            const output = transform([assignment])
            expect(output).toContain('class Empty')
            expect(output).not.toContain('data class Empty')
        })

        it('should escape Kotlin keywords used as field names', () => {
            const assignment: Group = {
                Type: 'group',
                Name: 'thing',
                IsChoiceAddition: false,
                Properties: [
                    { HasCut: false, Occurrence: { n: 1, m: 1 }, Name: 'object', Type: 'tstr', Comments: [] },
                ] as any,
                Comments: []
            }
            const output = transform([assignment])
            expect(output).toContain('val `object`: String')
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
            expect(output).toContain('data class NullValue(')
            // quoted "null" is the string literal type
            expect(output).toContain('val type: String,')
            // a bare `null` in a union still makes the field nullable
            expect(output).toContain('val value: String?')
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
            expect(output).toContain('typealias MyList = List<Int>')
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
