import fs from 'node:fs/promises'
import url from 'node:url'
import path from 'node:path'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
export const pkg = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'package.json'), 'utf-8'))

/**
 * Sentinel returned by the type resolver when it encounters a CDDL `null`/`nil`
 * type. Kotlin has no standalone null type, so consumers turn the surrounding
 * declaration into a nullable type instead.
 */
export const NULL_TYPE = '__cddl_null__'

/**
 * Fallback used whenever a CDDL construct cannot be expressed as a concrete
 * Kotlin type (e.g. inline unions of more than one non-null type). `Any?` is
 * used because CDDL `any` may also be null.
 */
export const ANY_TYPE = 'Any?'

export const CDDL_PARSE_ERROR_MESSAGE = 'Failed to transform CDDL into Kotlin: %s'

export const NATIVE_TYPE_MAP: Record<string, string> = {
    any: ANY_TYPE,
    number: 'Double',
    int: 'Int',
    uint: 'Long',
    nint: 'Int',
    float: 'Double',
    float16: 'Double',
    float32: 'Double',
    float64: 'Double',
    bool: 'Boolean',
    bstr: 'ByteArray',
    bytes: 'ByteArray',
    tstr: 'String',
    text: 'String',
    str: 'String',
}

/**
 * Kotlin hard keywords that cannot be used bare as identifiers. When a CDDL
 * property name collides with one of these it is escaped with backticks.
 */
export const KOTLIN_RESERVED_WORDS = new Set([
    'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun',
    'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return',
    'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val',
    'var', 'when', 'while',
])
