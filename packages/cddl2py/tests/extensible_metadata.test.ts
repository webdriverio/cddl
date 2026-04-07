import url from 'node:url'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import cli from '../src/cli.js'
import { normalizeSnapshotOutput } from './snapshot.js'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const cddlFile = path.join(__dirname, '..', '..', '..', 'examples', 'commons', 'extensible_metadata.cddl')

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

describe('extensible metadata', () => {
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

    it('should render extensible metadata as a TypedDict with extra_items', async () => {
        await cli([cddlFile])

        expect(process.exit).not.toHaveBeenCalledWith(1)
        expect(console.error).not.toHaveBeenCalled()

        const output = vi.mocked(console.log).mock.calls.flat().join('\n')

        expect(output).toContain('class MessageMetadata(TypedDict, extra_items=MetadataScalar):')
        expect(output).toContain('provider: NotRequired[str]')
        expect(output).toContain('model_type: NotRequired[str]')
        expect(output).toContain('system_fingerprint: NotRequired[str]')
        expect(output).not.toContain('text: NotRequired[MetadataScalar]')
        expect(normalizeSnapshotOutput(output)).toMatchSnapshot()
    })
})
