import camelcase from 'camelcase'

import { KOTLIN_RESERVED_WORDS } from './constants.js'

/**
 * Convert a CDDL property name into an idiomatic Kotlin property name.
 * Names that collide with Kotlin keywords are escaped with backticks.
 */
export function fieldName (name: string): string {
    const camel = camelcase(name)
    const safe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(camel) ? camel : `_${camel.replace(/[^A-Za-z0-9_]/g, '_')}`
    return KOTLIN_RESERVED_WORDS.has(safe) ? `\`${safe}\`` : safe
}

/**
 * Convert an arbitrary string into a valid Kotlin enum constant name
 * (UPPER_SNAKE_CASE).
 */
export function enumConstantName (value: string): string {
    let normalized = value
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')

    if (normalized === '' || /^[0-9]/.test(normalized)) {
        normalized = `_${normalized}`
    }

    return normalized.toUpperCase()
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
