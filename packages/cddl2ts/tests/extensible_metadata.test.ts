import url from 'node:url'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import cli from '../src/cli.js'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const cddlFile = path.join(__dirname, '..', '..', '..', 'examples', 'commons', 'extensible_metadata.cddl')

vi.mock('../src/constants', () => ({
    pkg: {
        name: 'cddl2ts',
        version: '0.0.0'
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

    it('should render extensible metadata as an interface with an index signature', async () => {
        await cli([cddlFile])

        expect(process.exit).not.toHaveBeenCalledWith(1)
        expect(console.error).not.toHaveBeenCalled()

        const output = vi.mocked(console.log).mock.calls.flat().join('\n')

        expect(output).toContain('export interface MessageMetadata {')
        expect(output).toContain('provider?: string;')
        expect(output).toContain('modelType?: string;')
        expect(output).toContain('[key: string]: MetadataScalar | undefined;')
        expect(output).not.toContain('text?: MetadataScalar;')
        expect(output).toMatchSnapshot()
    })
})
