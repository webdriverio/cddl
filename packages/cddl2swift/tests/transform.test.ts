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
            expect(output).toContain('public typealias DeviceAddress = String')
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
    })

    describe('snapshot tests with parsed CDDL', () => {
        it('should transform test.cddl correctly', () => {
            const ast = parse(path.join(__dirname, '..', '..', '..', 'examples', 'commons', 'test.cddl'))
            const output = transform(ast)
            expect(normalizeSnapshotOutput(output)).toMatchSnapshot()
        })
    })
})
