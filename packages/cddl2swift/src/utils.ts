import camelcase from 'camelcase'

import { SWIFT_RESERVED_WORDS } from './constants.js'

/**
 * Convert a CDDL property name into an idiomatic Swift property name.
 * Names that collide with Swift keywords are escaped with backticks.
 */
export function fieldName (name: string): string {
    const camel = camelcase(name)
    const safe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(camel) ? camel : `_${camel.replace(/[^A-Za-z0-9_]/g, '_')}`
    return SWIFT_RESERVED_WORDS.has(safe) ? `\`${safe}\`` : safe
}

/**
 * Convert an arbitrary string into a valid Swift enum case name (lowerCamelCase).
 */
export function enumCaseName (name: string): string {
    const camel = camelcase(name)
    const safe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(camel) ? camel : `_${camel.replace(/[^A-Za-z0-9_]/g, '_')}`
    const normalized = /^[0-9]/.test(safe) ? `_${safe}` : safe
    return SWIFT_RESERVED_WORDS.has(normalized) ? `\`${normalized}\`` : normalized
}

/**
 * Indent every non-empty line of a block of text by the given number of spaces.
 */
export function indent (text: string, spaces = 4): string {
    const pad = ' '.repeat(spaces)
    return text
        .split('\n')
        .map((line) => (line.length > 0 ? pad + line : line))
        .join('\n')
}
