import fs from 'node:fs/promises'
import url from 'node:url'
import path from 'node:path'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
export const pkg = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'package.json'), 'utf-8'))

/**
 * Sentinel returned by the type resolver when it encounters a CDDL `null`/`nil`
 * type. Swift has no standalone null type, so consumers turn the surrounding
 * declaration into an optional instead.
 */
export const NULL_TYPE = '__cddl_null__'

/**
 * Fallback used whenever a CDDL construct cannot be expressed as a concrete
 * Swift type (e.g. inline unions of more than one non-null type).
 */
export const ANY_TYPE = 'Any'

export const CDDL_PARSE_ERROR_MESSAGE = 'Failed to transform CDDL into Swift: %s'

export const NATIVE_TYPE_MAP: Record<string, string> = {
    any: ANY_TYPE,
    number: 'Double',
    int: 'Int',
    uint: 'Int',
    nint: 'Int',
    float: 'Double',
    float16: 'Double',
    float32: 'Double',
    float64: 'Double',
    bool: 'Bool',
    bstr: '[UInt8]',
    bytes: '[UInt8]',
    tstr: 'String',
    text: 'String',
    str: 'String',
}

/**
 * Swift keywords that cannot be used bare as identifiers. When a CDDL property
 * name collides with one of these it is escaped with backticks.
 */
export const SWIFT_RESERVED_WORDS = new Set([
    'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate',
    'func', 'import', 'init', 'inout', 'internal', 'let', 'open', 'operator',
    'private', 'precedencegroup', 'protocol', 'public', 'rethrows', 'static',
    'struct', 'subscript', 'typealias', 'var', 'break', 'case', 'catch',
    'continue', 'default', 'defer', 'do', 'else', 'fallthrough', 'for', 'guard',
    'if', 'in', 'repeat', 'return', 'throw', 'switch', 'where', 'while', 'as',
    'false', 'is', 'nil', 'self', 'Self', 'super', 'throws', 'true', 'try',
    'Any', 'Protocol', 'Type',
])
