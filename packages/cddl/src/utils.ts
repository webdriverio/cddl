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
    return typeof ch === 'string' && ch.length === 1 && '0' <= ch && ch <= '9'
}

export function isHexDigit (ch: string): boolean {
    return isDigit(ch) || ('a' <= ch && ch <= 'f') || ('A' <= ch && ch <= 'F')
}

export function hasSpecialNumberCharacter (ch: number) {
    return (
        ch === Tokens.MINUS.charCodeAt(0) ||
        ch === Tokens.DOT.charCodeAt(0) ||
        ch === 'x'.charCodeAt(0) ||
        ch === 'b'.charCodeAt(0)
    )
}

export function parseHexFloat (literal: string): number {
    const negative = literal.startsWith('-')
    const body = negative ? literal.slice(3) : literal.slice(2)
    const [mantissaPart, expPart] = body.split(/[pP]/)
    const [intPart, fracPart = ''] = mantissaPart.split('.')
    const exp = parseInt(expPart, 10)
    const mantissa = intPart.length + fracPart.length <= 13
        ? parseInt(intPart + fracPart, 16) * (2 ** -(fracPart.length * 4))
        : parseInt(intPart, 16) + [...fracPart].reduce((acc, d, idx) => acc + parseInt(d, 16) * (16 ** -(idx + 1)), 0)
    const value = mantissa * (2 ** exp)
    return negative ? -value : value
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
