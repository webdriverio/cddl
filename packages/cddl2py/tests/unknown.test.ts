import url from 'node:url'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import cli from '../src/cli.js'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const cddlFile = path.join(__dirname, '..', '..', '..', 'examples', 'commons', 'unknown.cddl')

vi.mock('../src/constants', () => ({
    pkg: {
        name: 'cddl2py',
        version: '0.1.0',
        author: 'Test Author',
        description: 'Generate Python types from CDDL'
    },
    NATIVE_TYPE_MAP: {
        any: 'Any',
        number: 'Union[int, float]',
        int: 'int',
        uint: 'int',
        nint: 'int',
        float: 'float',
        float16: 'float',
        float32: 'float',
        float64: 'float',
        bool: 'bool',
        bstr: 'bytes',
        bytes: 'bytes',
        tstr: 'str',
        text: 'str',
        str: 'str',
        nil: 'None',
        null: 'None',
    }
}))

describe('any type mapping', () => {
    let exitOrig = process.exit
    let logOrig = console.log
    let errorOrig = console.error

    beforeEach(() => {
        process.exit = vi.fn() as any
        console.log = vi.fn()
        console.error = vi.fn()
    })

    afterEach(() => {
        process.exit = exitOrig
        console.log = logOrig
        console.error = errorOrig
    })

    it('should map CDDL any to Python Any (TypedDict)', async () => {
        await cli([cddlFile])

        const output = vi.mocked(console.log).mock.calls.flat().join('\n')
        expect(output).toContain('Foo = Any')
        expect(output).toContain('Bar = list[Any]')
        expect(output).toContain('Baz = dict[str, Any]')
    })

    it('should map CDDL any to Python Any (Pydantic)', async () => {
        await cli([cddlFile, '--pydantic'])

        const output = vi.mocked(console.log).mock.calls.flat().join('\n')
        expect(output).toContain('Foo = Any')
        expect(output).toContain('Bar = list[Any]')
        expect(output).toContain('Baz = dict[str, Any]')
    })
})
