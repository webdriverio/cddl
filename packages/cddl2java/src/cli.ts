import fs from 'node:fs/promises'
import path from 'node:path'

import { transform } from './index.js'
import { pkg } from './constants.js'

const HELP = `
${pkg.name}
${pkg.description}

Usage:
runme2java ./path/to/spec.cddl &> ./outputDir

v${pkg.version}
Copyright ${(new Date()).getFullYear()} ${pkg.author}
`

export default async function cli (args = process.argv.slice(2)) {
    if (args.includes('--help') || args.length === 0) {
        console.log(HELP);
        return process.exit(0)
    }
    if (args.includes('--version') || args.includes('-v')) {
        console.log(pkg.version);
        return process.exit(0)
    }

    const cddlFilePath = path.isAbsolute(args[0]) ? args[0] : path.resolve(process.cwd(), args[0])
    const hasAccess = await fs.access(cddlFilePath).then(() => true, () => false)
    if (!hasAccess) {
        console.error(`Couldn't find or access source CDDL file at "${cddlFilePath}"`)
        return process.exit(1)
    }

    const outputDir = path.isAbsolute(args[1]) ? args[1] : path.resolve(process.cwd(), args[1])
    const hasAccessOutputDir = await fs.access(outputDir).then(() => true, () => false)
    if (!hasAccessOutputDir) {
        await fs.mkdir(outputDir, { recursive: true })
    }

    return transform(cddlFilePath, outputDir)
}
