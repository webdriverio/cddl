import url from 'node:url'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import cli from '../src/cli.js'
import { normalizeConsoleLogCalls } from './snapshot.js'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

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

describe('cddl2py CLI', () => {
    const exitOrig = process.exit.bind(process)
    const logOrig = console.log.bind(console)
    const errorOrig = console.error.bind(console)

    beforeEach(() => {
        // @ts-expect-error
        process.exit = vi.fn(() => {})
        console.log = vi.fn()
        console.error = vi.fn()
    })

    it('should print help if no args were provided', async () => {
        await cli([])

        expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/cddl2py/))
        expect(process.exit).toHaveBeenCalledWith(0)
    })

    it('should print help when --help is set', async () => {
        await cli(['foo', 'bar', '--help', 'barfoo'])

        expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/cddl2py/))
        expect(process.exit).toHaveBeenCalledWith(0)
    })

    it('should print version (alias)', async () => {
        await cli(['foo', '-v', 'bar'])

        expect(console.log).toHaveBeenCalledWith('0.1.0')
        expect(process.exit).toHaveBeenCalledWith(0)
    })

    it('should print version (long flag)', async () => {
        await cli(['foo', '--version', 'bar'])

        expect(console.log).toHaveBeenCalledWith('0.1.0')
        expect(process.exit).toHaveBeenCalledWith(0)
    })

    it('should fail if first parameter is not pointing to a file', async () => {
        await cli(['nonexistent.cddl'])

        expect(console.error).toHaveBeenCalledTimes(1)
        expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('should generate correct types for test.cddl', async () => {
        await cli([path.join(__dirname, '..', '..', '..', 'examples', 'commons', 'test.cddl')])

        expect(normalizeConsoleLogCalls(vi.mocked(console.log).mock.calls)).toMatchSnapshot()
        expect(process.exit).toHaveBeenCalledTimes(0)
    })

    it('should generate correct pydantic types for test.cddl', async () => {
        await cli([
            path.join(__dirname, '..', '..', '..', 'examples', 'commons', 'test.cddl'),
            '--pydantic'
        ])

        expect(normalizeConsoleLogCalls(vi.mocked(console.log).mock.calls)).toMatchSnapshot()
        expect(process.exit).toHaveBeenCalledTimes(0)
    })

    afterEach(() => {
        process.exit = exitOrig
        console.log = logOrig
        console.error = errorOrig
    })
})
