import { afterEach, describe, expect, it, vi } from 'vitest'

import { CLI_EPILOGUE } from '../src/cli/constants.js'

describe('cli entrypoint', () => {
    afterEach(() => {
        vi.resetModules()
        vi.restoreAllMocks()
    })

    it('wires yargs commands and returns argv', async () => {
        const command = vi.fn()
        const example = vi.fn()
        const epilogue = vi.fn()
        const demandCommand = vi.fn()
        const help = vi.fn()
        const argvValue = { _: ['repl'] }
        const chain = {
            command,
            example,
            epilogue,
            demandCommand,
            help,
            argv: argvValue
        }

        command.mockReturnValue(chain)
        example.mockReturnValue(chain)
        epilogue.mockReturnValue(chain)
        demandCommand.mockReturnValue(chain)
        help.mockReturnValue(chain)

        const yargsMock = vi.fn().mockReturnValue(chain)
        const hideBinMock = vi.fn().mockReturnValue(['repl'])

        vi.doMock('yargs/yargs', () => ({ default: yargsMock }))
        vi.doMock('yargs/helpers', () => ({ hideBin: hideBinMock }))

        const { default: runCli } = await import('../src/cli/index.js')
        const result = await runCli()

        expect(hideBinMock).toHaveBeenCalledWith(process.argv)
        expect(yargsMock).toHaveBeenCalledWith(['repl'])
        expect(command).toHaveBeenCalledTimes(2)
        expect(example).toHaveBeenCalledWith('$0 repl', 'Start CDDL repl')
        expect(epilogue).toHaveBeenCalledWith(CLI_EPILOGUE)
        expect(demandCommand).toHaveBeenCalledTimes(1)
        expect(help).toHaveBeenCalledTimes(1)
        expect(result).toEqual(argvValue)
    })
})
