import camelcase from 'camelcase'

import type {
    Assignment,
    Array as CDDLArray,
    Group,
    NativeTypeWithOperator,
    Property,
    PropertyReference,
    Variable
} from './ast.js'

import { Tokens, Token } from './tokens.js'

export function isLetter (ch: string): boolean {
    return 'a' <= ch && ch <= 'z' || 'A' <= ch && ch <= 'Z'
}

export function isAlphabeticCharacter (ch: string): boolean {
    return isLetter(ch) || ch === Tokens.ATSIGN || ch === Tokens.UNDERSCORE || ch === Tokens.DOLLAR
}

export function isDigit (ch: string): boolean {
    return typeof ch === 'string' && ch.length === 1 && ch >= '0' && ch <= '9'
}

export function isHexDigit (ch: string): boolean {
    return typeof ch === 'string' && ch.length === 1 && (
        (ch >= '0' && ch <= '9') ||
        (ch >= 'a' && ch <= 'f') ||
        (ch >= 'A' && ch <= 'F')
    )
}

export function hasSpecialNumberCharacter (ch: number) {
    return (
        ch === Tokens.MINUS.charCodeAt(0) ||
        ch === Tokens.DOT.charCodeAt(0) ||
        ch === 'x'.charCodeAt(0) ||
        ch === 'b'.charCodeAt(0)
    )
}

function parseHexFloat (literal: string): number {
    const isNegative = literal.startsWith('-')
    const normalized = literal.replace(/^-?0[xX]/, '')
    const [mantissaStr, exponentStr] = normalized.split(/[pP]/)
    const [intPart, fracPart] = mantissaStr.split('.')
    const fracValue = fracPart ? parseInt(fracPart, 16) / (16 ** fracPart.length) : 0
    let result = parseInt(intPart, 16) + fracValue
    let exp = parseInt(exponentStr, 10)
    if (!Number.isFinite(result) || result === 0) {
        return isNegative ? -result : result
    }
    if (!Number.isFinite(exp)) {
        const magnitude = exp > 0 ? Infinity : 0
        return isNegative ? -magnitude : magnitude
    }
    // Scale in <=512-bit steps so `2 ** exp` cannot underflow to 0 or overflow to Infinity
    // before multiplying by the mantissa (e.g. `0x4p-1076` == `Number.MIN_VALUE`)
    while (exp > 512 && Number.isFinite(result) && result !== 0) {
        result *= 2 ** 512
        exp -= 512
    }
    while (exp < -512 && Number.isFinite(result) && result !== 0) {
        result *= 2 ** -512
        exp += 512
    }
    result *= 2 ** exp
    return isNegative ? -result : result
}

export function parseNumberValue (token: Token): string | number {
    if (token.Type === Tokens.FLOAT) {
        if (/^-?0[xX]/.test(token.Literal)) {
            return parseHexFloat(token.Literal)
        }
        return parseFloat(token.Literal)
    }

    if (
        token.Literal.includes('x') ||
        token.Literal.includes('X') ||
        token.Literal.includes('b') ||
        token.Literal.includes('B')
    ) {
        return token.Literal
    }

    return parseInt(token.Literal, 10)
}

export function pascalCase (name: string) {
    return camelcase(name, { pascalCase: true })
}

export function isVariable (assignment: Assignment): assignment is Variable {
    return assignment.Type === 'variable'
}

export function isGroup (t: any): t is Group {
    return t && t.Type === 'group'
}

export function isCDDLArray (t: any): t is CDDLArray {
    return t && t.Type === 'array'
}

export function isProperty (t: any): t is Property {
    return t && typeof t.Name === 'string' && typeof t.HasCut === 'boolean'
}

export function isUnNamedProperty (t: any): t is Property & { Name: '' } {
    return isProperty(t) && t.Name === ''
}

export function isNamedGroupReference (t: any): t is PropertyReference & { Value: string } {
    return isGroup(t) && isPropertyReference(t) && typeof t.Value === 'string'
}

export function isPropertyReference (t: any): t is PropertyReference {
    return t && typeof t === 'object' && 'Value' in t
}

export function isNativeTypeWithOperator (t: any): t is NativeTypeWithOperator {
    return Boolean(
        t &&
        typeof t === 'object' &&
        'Type' in t &&
        !('Value' in t) &&
        t.Operator &&
        typeof t.Operator === 'object'
    )
}

export function getRegexpPattern (t: any): string | undefined {
    if (!isNativeTypeWithOperator(t)) {
        return
    }

    if (typeof t.Type !== 'string' || !['str', 'text', 'tstr'].includes(t.Type)) {
        return
    }

    if (t.Operator?.Type !== 'regexp' || !isLiteralWithValue(t.Operator.Value)) {
        return
    }

    return typeof t.Operator.Value.Value === 'string'
        ? t.Operator.Value.Value
        : undefined
}

export function isRange (t: any): boolean {
    return t && typeof t.Type === 'object' && (t.Type as any).Type === 'range'
}

/**
 * `true` if either bound of a range was written as a float (e.g. `(0.0..1.0)`),
 * including whole-valued floats that `Number.isInteger` alone can't distinguish
 * from `(0..1)` - see the `IsFloat` marker on numeric literal nodes. Min/Max are
 * typed as `number | string` but the parser actually emits literal nodes
 * (`{ Value, IsFloat? }`); handle both shapes.
 *
 * "Either bound" is deliberately permissive: RFC 8610 §2.2.2.1 only defines a range
 * as `int-range` (both bounds integer) or `float-range` (both bounds float) - a mixed
 * range like `0.5..10` is explicitly "NOT DEFINED" by the spec (its own BAD-range1/
 * BAD-range2 examples). For that undefined case we pick float rather than integer,
 * since it's the non-lossy choice - an integer type would corrupt real fractional
 * values, while a float type just represents whole numbers as e.g. `1.0`.
 *
 * A bound can also be a symbolic reference, e.g. `byte = 0..max-byte`, parsed as
 * `{ Type: 'group', Value: 'max-byte' }` - a string Value, not a number. That bound
 * is treated as non-float (we can't see what the reference resolves to), so it never
 * forces the range to float on its own.
 */
export function isFloatRange (range: any): boolean {
    const isFloatEndpoint = (node: any): boolean => {
        if (typeof node === 'number') {
            return !Number.isInteger(node)
        }
        return Boolean(node) && typeof node === 'object' &&
            (node.IsFloat === true || (typeof node.Value === 'number' && !Number.isInteger(node.Value)))
    }
    return Boolean(range) && (isFloatEndpoint(range.Min) || isFloatEndpoint(range.Max))
}

export function isLiteralWithValue (t: any): t is {
    Type: 'literal'
    Value: unknown
} {
    return t && t.Type === 'literal' && 'Value' in t
}
