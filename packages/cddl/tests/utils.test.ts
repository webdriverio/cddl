import { describe, it, expect } from 'vitest'

import type {
    Array as CDDLArray,
    Assignment,
    Comment,
    Group,
    NativeTypeWithOperator,
    Property,
    PropertyReference,
    Variable
} from '../src/ast.js'
import { Tokens, type Token } from '../src/tokens.js'
import {
    getRegexpPattern,
    hasSpecialNumberCharacter,
    isAlphabeticCharacter,
    isCDDLArray,
    isDigit,
    isGroup,
    isLetter,
    isLiteralWithValue,
    isNamedGroupReference,
    isNativeTypeWithOperator,
    isProperty,
    isPropertyReference,
    isRange,
    isUnNamedProperty,
    isVariable,
    parseNumberValue,
    pascalCase
} from '../src/utils.js'

const comments: Comment[] = []

function createVariable (): Variable {
    return {
        Type: 'variable',
        Name: 'my-variable',
        IsChoiceAddition: false,
        PropertyType: 'tstr',
        Comments: comments
    }
}

function createGroup (): Group {
    return {
        Type: 'group',
        Name: 'my-group',
        IsChoiceAddition: false,
        Properties: [],
        Comments: comments
    }
}

function createArray (): CDDLArray {
    return {
        Type: 'array',
        Name: 'my-array',
        Values: [],
        Comments: comments
    }
}

function createProperty (overrides: Partial<Property> = {}): Property {
    return {
        HasCut: false,
        Occurrence: { n: 1, m: 1 },
        Name: 'foo',
        Type: 'tstr',
        Comments: comments,
        ...overrides
    }
}

describe('utils', () => {
    describe('character helpers', () => {
        it('should detect letters and alphabetic characters', () => {
            expect(isLetter('a')).toBe(true)
            expect(isLetter('Z')).toBe(true)
            expect(isLetter('1')).toBe(false)

            expect(isAlphabeticCharacter('a')).toBe(true)
            expect(isAlphabeticCharacter(Tokens.ATSIGN)).toBe(true)
            expect(isAlphabeticCharacter(Tokens.UNDERSCORE)).toBe(true)
            expect(isAlphabeticCharacter(Tokens.DOLLAR)).toBe(true)
            expect(isAlphabeticCharacter('-')).toBe(false)
        })

        it('should detect digits and special number characters', () => {
            expect(isDigit('1')).toBe(true)
            expect(isDigit('0')).toBe(true)
            expect(isDigit('a')).toBe(false)
            expect(isDigit(Tokens.NL)).toBe(false)
            expect(isDigit(Tokens.SPACE)).toBe(false)

            expect(hasSpecialNumberCharacter(Tokens.MINUS.charCodeAt(0))).toBe(true)
            expect(hasSpecialNumberCharacter(Tokens.DOT.charCodeAt(0))).toBe(true)
            expect(hasSpecialNumberCharacter('x'.charCodeAt(0))).toBe(true)
            expect(hasSpecialNumberCharacter('b'.charCodeAt(0))).toBe(true)
            expect(hasSpecialNumberCharacter('1'.charCodeAt(0))).toBe(false)
        })
    })

    describe('number parsing helpers', () => {
        it('should parse floats, integers and prefixed numbers', () => {
            const floatToken: Token = { Type: Tokens.FLOAT, Literal: '12.5' }
            const intToken: Token = { Type: Tokens.INT, Literal: '42' }
            const hexToken: Token = { Type: Tokens.INT, Literal: '0x10' }
            const binaryToken: Token = { Type: Tokens.INT, Literal: '0b10' }

            expect(parseNumberValue(floatToken)).toBe(12.5)
            expect(parseNumberValue(intToken)).toBe(42)
            expect(parseNumberValue(hexToken)).toBe('0x10')
            expect(parseNumberValue(binaryToken)).toBe('0b10')
        })
    })

    describe('name helpers', () => {
        it('should convert names to pascal case', () => {
            expect(pascalCase('my-example_name')).toBe('MyExampleName')
        })
    })

    describe('assignment guards', () => {
        it('should detect variables, groups and arrays', () => {
            const variable: Assignment = createVariable()
            const group: Assignment = createGroup()
            const array: Assignment = createArray()

            expect(isVariable(variable)).toBe(true)
            expect(isVariable(group)).toBe(false)

            expect(isGroup(group)).toBe(true)
            expect(isGroup(variable)).toBe(false)

            expect(isCDDLArray(array)).toBe(true)
            expect(isCDDLArray(group)).toBe(false)
        })
    })

    describe('property guards', () => {
        it('should detect named and unnamed properties', () => {
            const property = createProperty()
            const unnamedProperty = createProperty({ Name: '' })

            expect(isProperty(property)).toBe(true)
            expect(isProperty({ Name: 'foo' })).toBe(false)

            expect(isUnNamedProperty(unnamedProperty)).toBe(true)
            expect(isUnNamedProperty(property)).toBe(false)
        })
    })

    describe('reference and operator guards', () => {
        it('should detect property references and named group references', () => {
            const groupReference: PropertyReference = {
                Type: 'group',
                Value: 'my-group',
                Unwrapped: false
            }
            const numericGroupReference: PropertyReference = {
                Type: 'group',
                Value: 123,
                Unwrapped: false
            }

            expect(isPropertyReference(groupReference)).toBe(true)
            expect(isPropertyReference({ Type: 'group' })).toBe(false)

            expect(isNamedGroupReference(groupReference)).toBe(true)
            expect(isNamedGroupReference(numericGroupReference)).toBe(false)
        })

        it('should detect native types with operators and ranges', () => {
            const nativeTypeWithOperator: NativeTypeWithOperator = {
                Type: {
                    Type: 'group',
                    Value: 'my-group',
                    Unwrapped: false
                },
                Operator: {
                    Type: 'default',
                    Value: 'tstr'
                }
            }
            const nativeStringTypeWithRegexp: NativeTypeWithOperator = {
                Type: 'tstr',
                Operator: {
                    Type: 'regexp',
                    Value: {
                        Type: 'literal',
                        Value: 'custom:.+',
                        Unwrapped: false
                    }
                }
            }
            const rangeReference: PropertyReference = {
                Type: 'range',
                Value: {
                    Min: 0,
                    Max: 10,
                    Inclusive: true
                },
                Unwrapped: false
            }

            expect(isNativeTypeWithOperator(nativeTypeWithOperator)).toBe(true)
            expect(isNativeTypeWithOperator(nativeStringTypeWithRegexp)).toBe(true)
            expect(isNativeTypeWithOperator({ Type: 'tstr' })).toBe(false)
            expect(getRegexpPattern(nativeStringTypeWithRegexp)).toBe('custom:.+')
            expect(getRegexpPattern(nativeTypeWithOperator)).toBeUndefined()

            expect(isRange({ Type: rangeReference })).toBe(true)
            expect(isRange({ Type: 'range' })).toBe(false)
        })
    })

    describe('literal guards', () => {
        it('should detect literals with values', () => {
            expect(isLiteralWithValue({ Type: 'literal', Value: 'foo' })).toBe(true)
            expect(isLiteralWithValue({ Type: 'literal' })).toBe(false)
            expect(isLiteralWithValue({ Type: 'group', Value: 'foo' })).toBe(false)
        })
    })
})
