import fs from 'node:fs/promises'
import url from 'node:url'
import path from 'node:path'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rimraf } from 'rimraf'

import cli from '../src/cli.js'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const fixturesDir = path.join(__dirname, '__fixtures__')
const outputDir = path.join(__dirname, '__output__')
// TODO: must point to examples/webdrvier/all.cddl
const bidiFile = path.join(__dirname, 'bidi.cddl')

const files = await findJavaFiles(fixturesDir)

describe('validate java transformation', () => {
    const exitFn = process.exit.bind(process)

    beforeAll(async () => {
        process.exit = vi.fn() as unknown as typeof process.exit
        rimraf.sync(outputDir)
        await cli([bidiFile, outputDir])
    })

    afterAll(() => {
        process.exit = exitFn
    })

    for (const file of files) {
        const filePath = file.slice(fixturesDir.length)
        it(filePath, async () => {
            const expected = (await fs.readFile(path.join(fixturesDir, filePath), 'utf-8')).toString()
            const actual = (await fs.readFile(path.join(outputDir, filePath), 'utf-8')).toString()
            expect(actual).toBe(expected)
        })
    }
})

/**
 * Find all .java files in a directory recursively
 * @param {string} directoryPath - The directory to search in
 * @param {Array} fileList - Array to collect the found files
 * @returns {Array} List of .java files with their full paths
 */
async function findJavaFiles(directoryPath: string, fileList: string[] = []) {
    // Read all items in the directory
    const items = await fs.readdir(directoryPath)

    // Process each item
    for (const item of items) {
        const itemPath = path.join(directoryPath, item)
        const stats = await fs.stat(itemPath)

        if (stats.isDirectory()) {
            // If it's a directory, recursively search inside it
            await findJavaFiles(itemPath, fileList)
        } else if (stats.isFile() && path.extname(item) === '.java') {
            // If it's a .java file, add it to our list
            fileList.push(itemPath)
        }
    }

    return fileList
}
