import url from 'node:url'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import cli from '../src/cli.js'
import { normalizeSnapshotOutput } from './snapshot.js'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const groupChoiceCDDL = path.join(__dirname, '..', '..', '..', 'examples', 'commons', 'group_choice.cddl')

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

describe('group choice conversion', () => {
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

    it('should generate a union type for multiple group choices (TypedDict)', async () => {
        await cli([groupChoiceCDDL])

        expect(process.exit).not.toHaveBeenCalledWith(1)
        expect(console.error).not.toHaveBeenCalled()
        expect(console.log).toHaveBeenCalled()
        const output = vi.mocked(console.log).mock.calls.flat().join('\n')

        expect(output).toContain('ProxyConfiguration = Union[AutodetectProxyConfiguration, DirectProxyConfiguration, ManualProxyConfiguration]')

        expect(output).toContain('class AutodetectProxyConfiguration(TypedDict):')
        expect(output).toContain('class DirectProxyConfiguration(TypedDict):')
        expect(output).toContain('class ManualProxyConfiguration(TypedDict):')

        expect(normalizeSnapshotOutput(output)).toMatchSnapshot()
    })

    it('should generate a union type for multiple group choices (Pydantic)', async () => {
        await cli([groupChoiceCDDL, '--pydantic'])

        expect(process.exit).not.toHaveBeenCalledWith(1)
        expect(console.error).not.toHaveBeenCalled()
        expect(console.log).toHaveBeenCalled()
        const output = vi.mocked(console.log).mock.calls.flat().join('\n')

        expect(output).toContain('ProxyConfiguration = Union[AutodetectProxyConfiguration, DirectProxyConfiguration, ManualProxyConfiguration]')

        expect(output).toContain('class AutodetectProxyConfiguration(BaseModel):')
        expect(output).toContain('class DirectProxyConfiguration(BaseModel):')
        expect(output).toContain('class ManualProxyConfiguration(BaseModel):')

        expect(normalizeSnapshotOutput(output)).toMatchSnapshot()
    })
})
