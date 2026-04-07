import url from 'node:url'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import cli from '../src/cli.js'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const cddlFile = path.join(__dirname, '..', '..', '..', 'examples', 'commons', 'named_group_choice.cddl')

vi.mock('../src/constants', () => ({
    pkg: {
        name: 'cddl2ts',
        version: '0.0.0'
    }
}))

describe('named group choice', () => {
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

    it('should generate a union type alias for named group references', async () => {
        await cli([cddlFile])

        expect(process.exit).not.toHaveBeenCalledWith(1)
        expect(console.error).not.toHaveBeenCalled()

        const output = vi.mocked(console.log).mock.calls.flat().join('\n')

        // Leading comments should render before the exported declaration.
        expect(output).toMatch(/(\/\/.*\n)+export type Choice = OptionA \| OptionB/)
        expect(output).toContain('export interface OptionA {')
        expect(output).toContain('export interface OptionB {')
    })
})
