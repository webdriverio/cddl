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
    return !isNaN(ch as unknown as number) && ch !== Tokens.NL && ch !== Tokens.SPACE
}

export function hasSpecialNumberCharacter (ch: number) {
    return (
        ch === Tokens.MINUS.charCodeAt(0) ||
        ch === Tokens.DOT.charCodeAt(0) ||
        ch === 'x'.charCodeAt(0) ||
        ch === 'b'.charCodeAt(0)
    )
}

export function parseNumberValue (token: Token): string | number {
    if (token.Type === Tokens.FLOAT) {
        return parseFloat(token.Literal)
    }

    if (
        token.Literal.includes('x') ||
        token.Literal.includes('b')
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

export function isLiteralWithValue (t: any): t is {
    Type: 'literal'
    Value: unknown
} {
    return t && t.Type === 'literal' && 'Value' in t
}
