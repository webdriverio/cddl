import fs from 'node:fs'

import Lexer from './lexer.js'
import { Property } from './ast.js'
import { Token, TokenType, Tokens } from './tokens.js';
import { PREDEFINED_IDENTIFIER, BOOLEAN_LITERALS } from './constants.js'
import { parseNumberValue } from './utils.js'
import {
    Type, PropertyName, PropertyType, PropertyReferenceType,
    Variable, RangePropertyReference, Occurrence, Assignment,
    Comment, Group, OperatorType, NativeTypeWithOperator, Operator,
    ByteEncoding, PropertyReference
} from './ast.js'

const NIL_TOKEN: Token = { Type: Tokens.ILLEGAL, Literal: '' }
const DEFAULT_OCCURRENCE: Occurrence = { n: 1, m: 1 } // exactly one time
const OPERATORS: OperatorType[] = ['default', 'size', 'regexp', 'bits', 'and', 'within', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'cbor', 'cborseq']
const OPERATORS_EXPECTING_VALUES: Record<OperatorType, PropertyReferenceType[] | undefined> = {
    default: undefined,
    size: ['literal', 'range'],
    regexp: ['literal'],
    bits: ['group'],
    and: ['group'],
    within: ['group'],
    eq: ['group'],
    ne: ['group'],
    lt: ['group'],
    le: ['group'],
    gt: ['group'],
    ge: ['group'],
    cbor: ['group'],
    cborseq: ['group'],
}

export default class Parser {
    #filePath: string
    l: Lexer;

    curToken: Token = NIL_TOKEN;
    peekToken: Token = NIL_TOKEN;
    peekBelowToken: Token = NIL_TOKEN;

    constructor (filePath: string) {
        this.#filePath = filePath
        this.l = new Lexer(fs.readFileSync(filePath, 'utf-8'))

        this.nextToken()
        this.nextToken()
        this.nextToken()
    }

    private nextToken () {
        this.curToken = this.peekToken
        this.peekToken = this.peekBelowToken
        this.peekBelowToken = this.l.nextToken()
        return true
    }

    private parseAssignments (): Assignment {
        const comments: Comment[] = []
        while (this.curToken.Type === Tokens.COMMENT) {
            const comment = this.parseComment()
            if (comment) {
                comments.push(comment)
            }
        }

        /**
         * expect group identifier, e.g.
         * groupName =
         * groupName /=
         * groupName //=
         * groupName<T, U> =
         */
        if (
            this.curToken.Type !== Tokens.IDENT ||
            !(this.peekToken.Type === Tokens.ASSIGN || this.peekToken.Type === Tokens.SLASH || this.peekToken.Type === Tokens.LT)
        ) {
            throw this.parserError(`group identifier expected, received "${JSON.stringify(this.curToken)}"`)
        }

        let isChoiceAddition = false
        const groupName = this.curToken.Literal
        this.nextToken() // eat group identifier

        const genericParameters = (this.curToken.Type as TokenType) === Tokens.LT
            ? this.parseGenericParameters()
            : undefined

        // @ts-ignore
        if (this.curToken.Type === Tokens.SLASH) {
            isChoiceAddition = true
            this.nextToken() // eat `/`
        }

        // @ts-ignore
        if (this.curToken.Type === Tokens.SLASH) {
            this.nextToken() // eat `/`
        }

        if ((this.curToken.Type as TokenType) !== Tokens.ASSIGN) {
            throw this.parserError(`Expected "=" after "${groupName}"`)
        }

        this.nextToken() // eat `=`
        const assignmentValue = this.parseAssignmentValue(groupName, isChoiceAddition) as Assignment

        // @ts-expect-error curToken can be changed by now but TS doesn't understand this
        while (this.curToken.Type === Tokens.COMMENT) {
            const comment = this.parseComment()
            comment && comments.push(comment)
        }
        assignmentValue.Comments = comments
        if (genericParameters) {
            assignmentValue.GenericParameters = genericParameters
        }
        return assignmentValue
    }

    private parseAssignmentValue (groupName?: string, isChoiceAddition = false): Assignment | PropertyType[] {
        let isChoice = false
        const valuesOrProperties: (Property | Property[])[] = []
        const closingTokens = this.openSegment()

        /**
         * if no group segment was opened we have a variable assignment
         * and can return immediatelly, e.g.
         *
         *   attire = "bow tie" / "necktie" / "Internet attire"
         *
         */
        if (closingTokens.length === 0) {
            if (groupName) {
                const variable: Variable = {
                    Type: 'variable',
                    Name: groupName,
                    IsChoiceAddition: isChoiceAddition,
                    PropertyType: this.parsePropertyTypes(true),
                    Comments: []
                }

                return variable
            }

            return this.parsePropertyTypes()
        }

        /**
         * type or group choices can be wrapped within `(` and `)`, e.g.
         *
         *   attireBlock = (
         *       "bow tie" /
         *       "necktie" /
         *       "Internet attire"
         *   )
         *   attireGroup = (
         *       attire //
         *       attireBlock
         *   )
         */
        if (
            closingTokens.includes(Tokens.RPAREN) &&
            this.peekToken.Type === Tokens.SLASH &&
            this.peekBelowToken.Type !== Tokens.SLASH &&
            !(this.curToken.Type === Tokens.SLASH && this.peekToken.Type === Tokens.SLASH)
        ) {
            const propertyType: PropertyType[] = []
            while (!closingTokens.includes(this.curToken.Type)) {
                propertyType.push(...this.parsePropertyTypes(true))
                if (closingTokens.includes(this.curToken.Type)) {
                    this.nextToken()
                    break
                }

                this.nextToken()

                if (this.curToken.Type === Tokens.SLASH) {
                    this.nextToken()
                }
            }
            if (this.curToken.Type === Tokens.RPAREN) {
                this.nextToken();
            }
            if (groupName) {
                const variable: Variable = {
                    Type: 'variable',
                    Name: groupName,
                    IsChoiceAddition: isChoiceAddition,
                    PropertyType: propertyType,
                    Comments: []
                }

                if (this.isOperator()) {
                    variable.Operator = this.parseOperator()
                }

                return variable
            }

            return propertyType
        }

        /**
         * parse operator assignments, e.g. `ip4 = (float .ge 0.0) .default 1.0`
         */
        if (closingTokens.length === 1 && this.peekToken.Type === Tokens.DOT) {
            const propertyType = this.parsePropertyType()
            const operator = this.isOperator() ? this.parseOperator() : undefined
            const prop: PropertyType = {
                Type: propertyType,
                ...(operator ? { Operator: operator } : {})
            } as NativeTypeWithOperator

            /**
             * this branch exists for the single-element case, e.g. `ip4 = (float .ge 0.0)`, where the operator's value is immediately followed by the closing token. If a comma follows instead, e.g. `[ bstr .size 3, bstr ]`, there are more elements still to come -- seed the general array/group loop below with this first element rather than assuming we are already done.
             */
            if (this.curToken.Type === Tokens.COMMA) {
                valuesOrProperties.push({
                    HasCut: false,
                    Occurrence: DEFAULT_OCCURRENCE,
                    Name: '',
                    Type: [prop],
                    Comments: []
                })
                this.nextToken() // eat comma
            } else {
                this.nextToken() // eat closing token
                if (groupName) {
                    const trailingOperator = this.isOperator() ? this.parseOperator() : undefined
                    const variable: Variable = {
                        Type: 'variable',
                        Name: groupName,
                        IsChoiceAddition: isChoiceAddition,
                        PropertyType: prop,
                        ...(trailingOperator ? { Operator: trailingOperator } : {}),
                        Comments: []
                    }

                    return variable
                }

                return [prop]
            }
        }

        while (!closingTokens.includes(this.curToken.Type)) {
            const comments: Comment[] = []
            let leadingComment = this.parseComment(true)
            while (leadingComment) {
                comments.push(leadingComment)
                leadingComment = this.parseComment(true)
            }

            /**
             * check if we have a group choice instead of an assignment
             */
            if (this.curToken.Type === Tokens.SLASH && this.peekToken.Type === Tokens.SLASH) {
                if (valuesOrProperties.length === 0) {
                    throw this.parserError('Unexpected group choice operator "//" at start of group')
                }

                if (!isChoice) {
                    const last = valuesOrProperties.pop() as Property
                    valuesOrProperties.push([last])
                    isChoice = true
                }
                this.nextToken()
                this.nextToken()
                continue
            }

            const propertyType: PropertyType[] = []
            let isUnwrapped = false
            let hasCut = false
            let propertyName = ''
            let keyType: PropertyType | undefined

            const occurrence = this.parseOccurrences()

            /**
             * check if variable name is unwrapped
             */
            if (this.curToken.Literal === Tokens.TILDE) {
                isUnwrapped = true
                this.nextToken() // eat ~
            }

            /**
             * parse assignment within array, e.g.
             * ```
             * ActionsPerformActionsParameters = [1* {
             *   type: "key",
             *   id: text,
             *   actions: ActionItems,
             *   *text => any
             * }]
             * ```
             * or
             * ```
             * script.MappingRemoteValue = [*[(script.RemoteValue / text), script.RemoteValue]];
             * ```
             */
            if (
                this.curToken.Literal === Tokens.LBRACE ||
                this.curToken.Literal === Tokens.LBRACK ||
                this.curToken.Literal === Tokens.LPAREN
            ) {
                const innerGroup = this.parseAssignmentValue() as Group
                if (this.isAtMemberKeySeparator()) {
                    keyType = innerGroup as PropertyType
                    propertyName = Array.isArray(innerGroup)
                        ? `(${(innerGroup as PropertyType[]).map((item) => this.formatPropertyKeyName(item)).join(' / ')})`
                        : this.formatPropertyKeyName(innerGroup as PropertyType)
                } else {
                    const prop = {
                        HasCut: false,
                        Occurrence: occurrence,
                        Name: '',
                        Type: innerGroup,
                        Comments: []
                    }

                    if (isChoice) {
                        (valuesOrProperties[valuesOrProperties.length - 1] as Property[]).push(prop)
                    } else {
                        valuesOrProperties.push(prop)
                    }

                    if (this.curToken.Type === Tokens.COMMA) {
                        this.nextToken()
                        isChoice = false
                    }

                    if (this.curToken.Type === Tokens.SLASH && this.peekToken.Type !== Tokens.SLASH) {
                        if (!isChoice) {
                            const last = valuesOrProperties.pop() as Property
                            valuesOrProperties.push([last])
                            isChoice = true
                        }
                        this.nextToken()
                    }
                    continue
                }
            } else if (this.curToken.Literal === Tokens.COMMA && closingTokens[0] === Tokens.RBRACK) {
                /**
                 * check if we are in an array and a new item is indicated
                 */
                this.nextToken()
                continue
            } else {

            const isSimpleNameEntry = (this.curToken.Type === Tokens.IDENT || this.curToken.Type === Tokens.STRING) &&
                this.peekToken.Type !== Tokens.LT &&
                !(this.peekToken.Type === Tokens.DOT && this.peekBelowToken.Type === Tokens.DOT)

            if (this.isDirectMemberKey()) {
                if (this.curToken.Type === Tokens.IDENT || this.curToken.Type === Tokens.STRING) {
                    propertyName = this.curToken.Literal
                    this.nextToken()
                } else {
                    keyType = this.parsePropertyType()
                    this.advanceAfterPropertyType()
                    propertyName = this.formatPropertyKeyName(keyType)
                }
            } else if (isSimpleNameEntry) {
                propertyName = this.parsePropertyName()

                /**
                 * an unnamed member decorated with an operator, e.g. `[ bstr .size 3, bstr ]` --
                 * unless followed by `^` or `=>` as a map member key.
                 */
                if (this.isOperator()) {
                    const operator = this.parseOperator()
                    const baseType = PREDEFINED_IDENTIFIER.includes(propertyName)
                        ? { Type: propertyName as Type }
                        : {
                            Type: 'group' as PropertyReferenceType,
                            Value: propertyName,
                            Unwrapped: isUnwrapped
                        }
                    const typeWithOp: PropertyType = { ...baseType, Operator: operator }
                    if (this.isAtMemberKeySeparator()) {
                        keyType = typeWithOp
                        propertyName = this.formatPropertyKeyName(typeWithOp)
                    } else {
                        valuesOrProperties.push({
                            HasCut: hasCut,
                            Occurrence: occurrence,
                            Name: '',
                            Type: [typeWithOp],
                            Comments: []
                        })

                        if (this.curToken.Type === Tokens.COMMA) {
                            this.nextToken()
                            isChoice = false
                        }
                        continue
                    }
                }
            } else {
                const parsedType = this.parsePropertyTypeWithOperator()
                if (isUnwrapped && typeof parsedType === 'object' && 'Unwrapped' in parsedType) {
                    parsedType.Unwrapped = true
                }

                if (this.isAtMemberKeySeparator()) {
                    keyType = parsedType
                    propertyName = this.formatPropertyKeyName(parsedType)
                } else if (this.curToken.Type === Tokens.SLASH && this.peekToken.Type === Tokens.SLASH) {
                    const prop: Property = {
                        HasCut: hasCut,
                        Occurrence: occurrence,
                        Name: '',
                        Type: parsedType,
                        Comments: comments
                    }
                    if (isChoice) {
                        (valuesOrProperties[valuesOrProperties.length - 1] as Property[]).push(prop)
                    } else {
                        isChoice = true
                        valuesOrProperties.push([prop])
                    }
                    this.nextToken() // eat /
                    this.nextToken() // eat /
                    continue
                } else {
                    const typeChoices = this.collectTypeChoices(parsedType)
                    const res = this.pushUnnamedMember(valuesOrProperties, closingTokens, occurrence, hasCut, typeChoices, isChoice)
                    isChoice = res.nextIsChoice
                    if (res.shouldContinue) {
                        continue
                    }
                    break
                }
            }

            /**
             * if `,` is found we have a group reference and jump to the next line
             */
            if (this.curToken.Type === Tokens.COMMA || closingTokens.includes(this.curToken.Type)) {
                const resolvedType: PropertyType | PropertyType[] = PREDEFINED_IDENTIFIER.includes(propertyName)
                    ? propertyName
                    : [{
                        Type: 'group' as PropertyReferenceType,
                        Value: propertyName,
                        Unwrapped: isUnwrapped
                    }]

                const hadComma = this.curToken.Type === Tokens.COMMA
                const res = this.pushUnnamedMember(valuesOrProperties, closingTokens, occurrence, hasCut, resolvedType, false)
                if (hadComma) {
                    isChoice = false
                }
                if (res.shouldContinue) {
                    continue
                }
                break
            }
            }

            /**
             * check if property has cut, which happens if a property is described as
             * - `? "optional-key" ^ => int,`
             * - `? optional-key: int,` - since the colon shortcut includes cuts
             */
            if (this.curToken.Type === Tokens.CARET || this.curToken.Type === Tokens.COLON) {
                hasCut = true

                if (this.curToken.Type === Tokens.CARET) {
                    this.nextToken() // eat ^
                }
            }

            /**
             * check if we have a group choice instead of an assignment
             */
            if (this.curToken.Type === Tokens.SLASH && this.peekToken.Type === Tokens.SLASH) {
                const prop: Property = {
                    HasCut: hasCut,
                    Occurrence: occurrence,
                    Name: '',
                    Type: {
                        Type: 'group',
                        Value: propertyName,
                        Unwrapped: isUnwrapped
                    },
                    Comments: comments
                }

                if (isChoice) {
                    /**
                     * if we already in a choice just push into it
                     */
                    (valuesOrProperties[valuesOrProperties.length - 1] as Property[]).push(prop)
                } else {
                    /**
                     * otherwise create a new one
                     */
                    isChoice = true
                    valuesOrProperties.push([prop])
                }

                this.nextToken() // eat /
                this.nextToken() // eat /
                continue
            }

            /**
             * else if no colon was found, throw
             */
            if (!this.isPropertyValueSeparator()) {
                throw this.parserError('Expected ":" or "=>"')
            }

            this.nextToken() // eat :

            /**
             * parse property value
             */
            const props = this.parseAssignmentValue()
            let operator = this.isOperator() ? this.parseOperator() : undefined
            if (!isChoice && this.curToken.Type === Tokens.SLASH && this.peekToken.Type !== Tokens.SLASH) {
                this.nextToken()
                const nextType = this.parsePropertyType()
                if (Array.isArray(props)) {
                    /**
                     * property has not yet been flagged as a choice, but is part
                     * of one, e.g. `(float .ge 1.0) / null`
                     */
                    props.push(nextType)
                    if (!this.isOperator()) {
                        this.nextToken()
                    }
                }
            }
            if (this.isOperator()) {
                operator = this.parseOperator()
            }
            if (Array.isArray(props)) {
                /**
                 * property has multiple types (e.g. `float / tstr / int`)
                 */
                propertyType.push(...props)
            } else {
                propertyType.push(props)
            }

            /**
             * advance comma
             */
            let flipIsChoice = false
            if (this.curToken.Type === Tokens.COMMA) {
                /**
                 * if we are in a choice, we leave it here
                 */
                flipIsChoice = true

                this.nextToken() // eat ,
            }

            const trailingComment = this.parseComment()
            trailingComment && comments.push(trailingComment)

            const prop: Property = {
                HasCut: hasCut,
                Occurrence: occurrence,
                Name: propertyName,
                Type: propertyType,
                Comments: comments,
                ...(operator ? { Operator: operator } : {}),
                ...(keyType ? { KeyType: keyType } : {})
            }

            if (isChoice) {
                (valuesOrProperties[valuesOrProperties.length - 1] as Property[]).push(prop)
            } else {
                valuesOrProperties.push(prop)
            }

            if (flipIsChoice) {
                isChoice = false
            }

            /**
             * if `}` is found we are at the end of the group
             */
            if (closingTokens.includes(this.curToken.Type)) {
                /**
                 * Handle the case where a group is followed by an inclusion operator, e.g.
                 *
                 * group1 = {
                 *   name: tstr,
                 *   age: number,
                 * }
                 *
                 * group2 = {
                 *   handle: tstr
                 * } .and group1
                 *
                 */
                while (this.peekToken.Type === Tokens.DOT) {
                    this.nextToken()
                    if (this.isOperator()) {
                        valuesOrProperties.push({
                            Name: '',
                            Type: 'group',
                            Occurrence: DEFAULT_OCCURRENCE,
                            Operator: this.parseOperator(),
                            Comments: [],
                            HasCut: false,
                        })
                    }
                }
                break
            }

            /**
             * eat // if we are in a choice
             */
            if (isChoice) {
                this.nextToken() // eat /
                this.nextToken() // eat /
                continue
            }
        }

        /**
         * close segment
         */
        if (this.curToken.Type === [...closingTokens].shift()) {
            this.nextToken()
        }

        /**
         * if last closing token is "]" we have an array
         */
        if (closingTokens[closingTokens.length - 1] === Tokens.RBRACK) {
            return {
                Type: 'array',
                Name: groupName || '',
                Values: valuesOrProperties,
                Comments: []
            }
        }

        /**
         * simplify wrapped types, e.g. from
         * {
         *     "Type": "group",
         *     "Name": "",
         *     "Properties": [
         *         {
         *             "HasCut": false,
         *             "Occurrence": {
         *                 "n": 1,
         *                 "m": 1
         *             },
         *             "Name": "",
         *             "Type": "bool",
         *             "Comment": ""
         *         }
         *     ],
         *     "IsChoiceAddition": false
         * }
         * back to:
         * bool
         */
        if (!groupName && valuesOrProperties.length === 1 && PREDEFINED_IDENTIFIER.includes((valuesOrProperties[0] as Property).Type as string)) {
            return (valuesOrProperties[0] as Property).Type as Assignment
        }

        /**
         * otherwise a group
         */
        return {
            Type: 'group',
            Name: groupName || '',
            Properties: valuesOrProperties,
            IsChoiceAddition: isChoiceAddition,
            Comments: []
        }
    }

    private isPropertyValueSeparator () {
        if (this.curToken.Type === Tokens.COLON) {
            return true
        }

        if (this.curToken.Type === Tokens.ASSIGN && this.peekToken.Type === Tokens.GT) {
            this.nextToken() // eat <
            return true
        }

        return false
    }

    /**
     * checks if group segment is opened and forwards to beginning of
     * first property declaration
     * @returns {String[]}  closing tokens for group (either `}`, `)` or both)
     */
    private openSegment (): string[] {
        if (this.curToken.Type === Tokens.LBRACE) {
            this.nextToken()
            return [Tokens.RBRACE]
        } else if (this.curToken.Type === Tokens.LPAREN) {
            this.nextToken()
            return [Tokens.RPAREN]
        } else if (this.curToken.Type === Tokens.LBRACK) {
            this.nextToken()
            return [Tokens.RBRACK]
        }

        return []
    }

    private parsePropertyName (): PropertyName {
        /**
         * property name without quotes
         */
        if (this.curToken.Type === Tokens.IDENT || this.curToken.Type === Tokens.STRING) {
            const name = this.curToken.Literal
            this.nextToken()
            return name
        }

        throw this.parserError(`Expected property name, received ${this.curToken.Type}(${this.curToken.Literal}), ${this.peekToken.Type}(${this.peekToken.Literal})`)
    }

    private parsePropertyType (): PropertyType {
        let type: PropertyType | undefined = undefined
        let isUnwrapped = false
        let isGroupedRange = false

        /**
         * check if variable name is unwrapped
         */
        if (this.curToken.Literal === Tokens.TILDE) {
            isUnwrapped = true
            this.nextToken() // eat ~
        }

        const alreadyAdvanced = this.curToken.Literal === Tokens.LBRACE || this.curToken.Literal === Tokens.LBRACK

        /**
         * a quoted string or byte string is always a literal, even if its text
         * matches a reserved keyword like "null" or "bool"
         */
        const switchKey = this.curToken.Type === Tokens.STRING || this.curToken.Type === Tokens.BYTES
            ? this.curToken.Type
            : this.curToken.Literal
        switch (switchKey) {
            case Type.ANY:
            case Type.BOOL:
            case Type.INT:
            case Type.UINT:
            case Type.NINT:
            case Type.FLOAT:
            case Type.FLOAT16:
            case Type.FLOAT32:
            case Type.FLOAT64:
            case Type.BSTR:
            case Type.BYTES:
            case Type.TSTR:
            case Type.TEXT:
            case Type.NIL:
            case Type.NULL:
                type = this.curToken.Literal
                break
            default: {
                if (this.curToken.Type === Tokens.STRING) {
                    type = {
                        Type: 'literal' as PropertyReferenceType,
                        Value: this.curToken.Literal,
                        Unwrapped: isUnwrapped
                    }
                } else if (this.curToken.Type === Tokens.BYTES) {
                    type = this.parseByteStringLiteral(this.curToken.Literal, isUnwrapped)
                } else if (BOOLEAN_LITERALS.includes(this.curToken.Literal)) {
                    type = {
                        Type: 'literal' as PropertyReferenceType,
                        Value: this.curToken.Literal === 'true',
                        Unwrapped: isUnwrapped
                    }
                } else if (this.curToken.Literal === Tokens.LBRACE || this.curToken.Literal === Tokens.LBRACK) {
                    const val = this.parseAssignmentValue()
                    if (Array.isArray(val)) {
                        throw new Error('Unexpected array in property type parsing')
                    }
                    type = val
                } else if (this.curToken.Type === Tokens.IDENT) {
                    const name = this.curToken.Literal
                    type = {
                        Type: 'group' as PropertyReferenceType,
                        Value: name,
                        Unwrapped: isUnwrapped,
                        ...(this.peekToken.Type === Tokens.LT ? { GenericArguments: this.parseGenericArguments() } : {})
                    }
                } else if (this.curToken.Type === Tokens.NUMBER || this.curToken.Type === Tokens.FLOAT) {
                    type = {
                        Type: 'literal' as PropertyReferenceType,
                        Value: parseNumberValue(this.curToken),
                        Unwrapped: isUnwrapped,
                        ...(this.curToken.Type === Tokens.FLOAT ? { IsFloat: true } : {})
                    }
                } else if (this.curToken.Type === Tokens.HASH) {
                    this.nextToken()
                    const n = parseNumberValue(this.curToken)
                    this.nextToken() // eat numeric value
                    this.nextToken() // eat (
                    const t = this.parsePropertyType()
                    this.nextToken() // eat )
                    type = {
                        Type: 'tag',
                        Value: {
                            NumericPart: n as number,
                            TypePart: t as string
                        },
                        Unwrapped: isUnwrapped
                    }
                } else if (this.curToken.Literal === Tokens.LPAREN && (this.peekToken.Type === Tokens.NUMBER || this.peekToken.Type === Tokens.FLOAT)) {
                    this.nextToken()
                    type = {
                        Type: 'literal' as PropertyReferenceType,
                        Value: parseNumberValue(this.curToken),
                        Unwrapped: isUnwrapped,
                        ...(this.curToken.Type === Tokens.FLOAT ? { IsFloat: true } : {})
                    }
                    isGroupedRange = true
                } else {
                    throw this.parserError(`Invalid property type "${this.curToken.Literal}"`)
                }
            }
        }

        /**
         * check if type continue as a range
         */
        if (
            !alreadyAdvanced &&
            this.peekToken.Type === Tokens.DOT &&
            this.nextToken() &&
            this.peekToken.Type === Tokens.DOT
        ) {
            this.nextToken()
            let Inclusive = true

            /**
             * check if range excludes upper bound
             */
            if (this.peekToken.Type === Tokens.DOT) {
                Inclusive = false
                this.nextToken()
            }

            this.nextToken()

            if (!type || (typeof type === 'object' && !('Value' in type))) {
                throw new Error('Invalid type for range definition')
            }

            const Min: RangePropertyReference = typeof type === 'string' || typeof type.Value === 'number'
                ? type as string
                : type.Value as (number | string)
            type = {
                Type: 'range' as PropertyReferenceType,
                Value: {
                    Inclusive,
                    Min,
                    Max: this.parsePropertyType() as RangePropertyReference
                },
                Unwrapped: isUnwrapped
            }

            if (!isGroupedRange && this.peekToken.Literal === Tokens.RPAREN) {
                /**
                 * If we are at the end of a grouped range, and this was called
                 * on the first item of the range as opposed to the opening
                 * parenthesis, isGroupedRange will not be set to true at this
                 * point. We need to advance to the closing parenthesis, and if
                 * the next token is an operator, we need to advance to the dot
                 * so that parseOperator will work properly.
                 * e.g.
                 *
                 * ```
                 * (1.0..2.0) .default 1.5
                 * ```
                 *
                 * This will be called on the `1.0` and then the `2.0` will be parsed
                 * as a grouped range.
                 */
                this.nextToken()
                if (this.isOperator()) {
                    isGroupedRange = true
                }
            }

            if (isGroupedRange) {
                this.nextToken() // eat ")"
            }
        }

        if (!type) {
            const { line, position: column } = this.l.getLocation()
            throw new Error(`Unexpected type: ${this.curToken.Type} at line ${line} column ${column}`)
        }

        return type
    }

    private parseOperator (): Operator {
        const type = this.peekToken.Literal as OperatorType
        if (this.curToken.Literal !== Tokens.DOT || !OPERATORS.includes(this.peekToken.Literal as OperatorType)) {
            throw new Error(`Operator ".${type}", expects a ${OPERATORS_EXPECTING_VALUES[type]!.join(' or ')} property, but found ${this.peekToken.Literal}!`)
        }

        this.nextToken() // eat "."
        this.nextToken() // eat operator type
        const value = this.parsePropertyType() as PropertyReferenceType
        this.nextToken() // eat operator value
        return {
            Type: type,
            Value: value
        }
    }

    private isOperator () {
        return this.curToken.Literal === Tokens.DOT && OPERATORS.includes(this.peekToken.Literal as OperatorType)
    }

    private parsePropertyTypes (attachChoiceOperators = false): PropertyType[] {
        const propertyTypes: PropertyType[] = []

        let prop: PropertyType = this.parsePropertyType()
        if (this.isOperator()) {
            prop = {
                Type: prop,
                Operator: this.parseOperator()
            } as NativeTypeWithOperator
        } else if (this.curToken.Type !== Tokens.SLASH) {
            this.nextToken() // eat Property if not already consumed (e.g. by Group parsing)
        }

        propertyTypes.push(prop)

        /**
         * ignore comments between type choice members, e.g.
         * ```
         * Foo = int ; comment
         *     / text
         * ```
         * or
         * ```
         * Foo = int / ; comment
         *     text
         * ```
         */
        while (this.curToken.Type === Tokens.COMMENT && this.peekToken.Type === Tokens.SLASH) {
            this.parseComment()
        }

        /**
         * ensure we don't go into the next choice, e.g.:
         * ```
         * delivery = (
         *   city // lala: tstr / bool // per-pickup: true,
         * )
         */
        if (this.curToken.Type === Tokens.SLASH && this.peekToken.Type === Tokens.SLASH) {
            return propertyTypes
        }

        /**
         * capture more if available (e.g. `tstr / float / boolean`)
         */
        while (this.curToken.Type === Tokens.SLASH) {
            this.nextToken() // eat `/`
            while ([Tokens.COMMENT].includes(this.curToken.Type)) {
                this.parseComment()
            }
            let nextProp: PropertyType = this.parsePropertyType()
            if (this.isOperator()) {
                if (attachChoiceOperators) {
                    nextProp = {
                        Type: nextProp,
                        Operator: this.parseOperator()
                    } as NativeTypeWithOperator
                }
            } else if (this.curToken.Type !== Tokens.SLASH) {
                /**
                 * If we are not parsing an operator, we need to eat the next token;
                 * otherwise, the operator will be parsed by the caller
                 */
                this.nextToken()
            }
            propertyTypes.push(nextProp)

            while ([Tokens.COMMENT].includes(this.curToken.Type) && this.peekToken.Type === Tokens.SLASH) {
                this.parseComment()
            }

            /**
             * ensure we don't go into the next choice, e.g.:
             * ```
             * delivery = (
             *   city // lala: tstr / bool // per-pickup: true,
             * )
             */
            if (this.curToken.Type === Tokens.SLASH && this.peekToken.Type === Tokens.SLASH) {
                break
            }
        }

        return propertyTypes
    }

    private isOccurrenceUpperBound (followingToken: Token): boolean {
        return ![
            Tokens.DOT,
            Tokens.COLON,
            Tokens.CARET,
            Tokens.ASSIGN,
            Tokens.COMMA,
            Tokens.RBRACK,
            Tokens.RBRACE,
            Tokens.RPAREN,
            Tokens.SLASH,
            Tokens.EOF
        ].includes(followingToken.Type as Tokens)
    }

    private isDirectMemberKey (): boolean {
        const isKeyToken = [
            Tokens.IDENT,
            Tokens.STRING,
            Tokens.NUMBER,
            Tokens.FLOAT,
            Tokens.BYTES
        ].includes(this.curToken.Type as Tokens)
        if (!isKeyToken) {
            return false
        }
        return this.peekToken.Type === Tokens.COLON ||
            this.peekToken.Type === Tokens.CARET ||
            (this.peekToken.Type === Tokens.ASSIGN && this.peekBelowToken.Type === Tokens.GT)
    }

    private isAtMemberKeySeparator (): boolean {
        return this.curToken.Type === Tokens.CARET ||
            this.curToken.Type === Tokens.COLON ||
            (this.curToken.Type === Tokens.ASSIGN && this.peekToken.Type === Tokens.GT)
    }

    private parseByteStringLiteral (literal: string, isUnwrapped = false): PropertyReference {
        const lower = literal.toLowerCase()
        let encoding: ByteEncoding = 'utf8'
        let prefixLen = 1
        if (lower.startsWith("h'")) {
            encoding = 'hex'
            prefixLen = 2
        } else if (lower.startsWith("b64'")) {
            encoding = 'b64'
            prefixLen = 4
        }
        const value = literal.endsWith("'") && literal.length > prefixLen
            ? literal.slice(prefixLen, -1)
            : literal.slice(prefixLen)
        return {
            Type: 'literal',
            Value: value,
            Unwrapped: isUnwrapped,
            IsByteString: true,
            ByteEncoding: encoding
        }
    }

    private advanceAfterPropertyType (): void {
        // parsePropertyType leaves curToken on its last token unless range lookahead already moved onto "."
        if (this.curToken.Type !== Tokens.DOT) {
            this.nextToken()
        }
    }

    private parsePropertyTypeWithOperator (): PropertyType {
        // parseAssignmentValue for `{...}`/`[...]` already consumes the closing delimiter
        const alreadyAdvanced = this.curToken.Literal === Tokens.LBRACE || this.curToken.Literal === Tokens.LBRACK
        const type = this.parsePropertyType()
        if (!alreadyAdvanced) {
            this.advanceAfterPropertyType()
        }
        if (!this.isOperator()) {
            return type
        }
        const operator = this.parseOperator()
        return (typeof type === 'string'
            ? { Type: type as Type, Operator: operator }
            : { ...(type as object), Operator: operator }) as PropertyType
    }

    private skipComments (): void {
        while ((this.curToken.Type as TokenType) === Tokens.COMMENT) {
            this.parseComment()
        }
    }

    private collectTypeChoices (firstType: PropertyType): PropertyType[] {
        const choices: PropertyType[] = [firstType]
        while (this.curToken.Type === Tokens.SLASH && this.peekToken.Type !== Tokens.SLASH) {
            this.nextToken() // eat /
            this.skipComments()
            choices.push(this.parsePropertyTypeWithOperator())
        }
        return choices
    }

    private pushUnnamedMember (
        valuesOrProperties: (Property | Property[])[],
        closingTokens: string[],
        occurrence: Occurrence,
        hasCut: boolean,
        type: PropertyType | PropertyType[],
        appendToActiveChoice: boolean
    ): { shouldContinue: boolean, nextIsChoice: boolean } {
        const tokenType = this.curToken.Type
        let comment: Comment | undefined

        if (this.curToken.Type === Tokens.COMMA && this.peekToken.Type === Tokens.COMMENT) {
            this.nextToken()
            comment = this.parseComment()
        } else if (this.curToken.Type === Tokens.COMMENT) {
            comment = this.parseComment()
        }

        const prop: Property = {
            HasCut: hasCut,
            Occurrence: occurrence,
            Name: '',
            Type: type,
            Comments: comment ? [comment] : []
        }

        if (appendToActiveChoice) {
            (valuesOrProperties[valuesOrProperties.length - 1] as Property[]).push(prop)
        } else {
            valuesOrProperties.push(prop)
        }

        const nextIsChoice = appendToActiveChoice && tokenType !== Tokens.COMMA

        if (this.curToken.Literal === Tokens.COMMA || this.curToken.Literal === closingTokens[0]) {
            if (this.curToken.Literal === Tokens.COMMA) {
                this.nextToken()
            }
            return { shouldContinue: true, nextIsChoice }
        }

        return { shouldContinue: tokenType === Tokens.COMMA, nextIsChoice }
    }

    private formatPropertyKeyName (type: PropertyType): string {
        if (typeof type === 'string') {
            return type
        }
        if ('Operator' in type && type.Operator) {
            const base = 'Value' in type
                ? this.formatPropertyKeyName({ ...(type as object), Operator: undefined } as PropertyType)
                : this.formatPropertyKeyName(type.Type)
            return `${base} .${type.Operator.Type} ${this.formatPropertyKeyName(type.Operator.Value)}`
        }
        if (type.Type === 'literal') {
            if (type.IsByteString) {
                const prefix = type.ByteEncoding === 'hex' ? 'h' : type.ByteEncoding === 'b64' ? 'b64' : ''
                return `${prefix}'${type.Value}'`
            }
            return String(type.Value)
        }
        if (type.Type === 'group' && 'Value' in type) {
            const args = type.GenericArguments?.map((arg) => this.formatPropertyKeyName(arg))
            return args ? `${type.Value}<${args.join(', ')}>` : String(type.Value)
        }
        if (type.Type === 'range') {
            const range = type.Value as { Inclusive: boolean, Min: RangePropertyReference, Max: RangePropertyReference }
            const formatEndpoint = (endpoint: RangePropertyReference): string =>
                typeof endpoint === 'object' && endpoint !== null && 'Value' in endpoint
                    ? String((endpoint as { Value: unknown }).Value)
                    : String(endpoint)
            const op = range.Inclusive ? '..' : '...'
            return `${formatEndpoint(range.Min)}${op}${formatEndpoint(range.Max)}`
        }
        if (type.Type === 'tag' && 'Value' in type) {
            const tag = type.Value as { NumericPart: number, TypePart: PropertyType }
            return `#${tag.NumericPart}(${this.formatPropertyKeyName(tag.TypePart)})`
        }
        return type.Type === 'array' ? '[...]' : '{...}'
    }

    private parseGenericParameters (): string[] {
        const params: string[] = []
        this.nextToken() // eat "<"
        this.skipComments()

        while (true) {
            if (this.curToken.Type !== Tokens.IDENT) {
                throw this.parserError(`Expected generic parameter identifier, received "${JSON.stringify(this.curToken)}"`)
            }
            params.push(this.curToken.Literal)
            this.nextToken()
            this.skipComments()

            if ((this.curToken.Type as TokenType) === Tokens.COMMA) {
                this.nextToken()
                this.skipComments()
                continue
            }
            break
        }

        if ((this.curToken.Type as TokenType) !== Tokens.GT) {
            throw this.parserError(`Expected ">" to close generic parameter list, received "${JSON.stringify(this.curToken)}"`)
        }
        this.nextToken() // eat ">"
        return params
    }

    private parseGenericArguments (): PropertyType[] {
        const args: PropertyType[] = []
        this.nextToken() // eat IDENT
        this.nextToken() // eat "<"
        this.skipComments()

        while (true) {
            args.push(this.parsePropertyTypeWithOperator())
            this.skipComments()

            if ((this.curToken.Type as TokenType) === Tokens.COMMA) {
                this.nextToken()
                this.skipComments()
                continue
            }
            break
        }

        if ((this.curToken.Type as TokenType) !== Tokens.GT) {
            throw this.parserError(`Expected ">" to close generic argument list, received "${JSON.stringify(this.curToken)}"`)
        }
        // Leave curToken on ">" so parsePropertyType()'s trailing-token invariant holds
        return args
    }

    private parseOccurrences () {
        let occurrence = DEFAULT_OCCURRENCE

        /**
         * check for non-numbered occurrence indicator, e.g.
         * ```
         *  * bedroom: size,
         * ```
         * which is the same as:
         * ```
         *  ? bedroom: size,
         * ```
         * or have miniumum of 1 occurrence
         * ```
         *  + bedroom: size,
         * ```
         */
        if (this.curToken.Type === Tokens.QUEST || this.curToken.Type === Tokens.ASTERISK || this.curToken.Type === Tokens.PLUS) {
            const n = this.curToken.Type === Tokens.PLUS ? 1 : 0
            let m = this.curToken.Type === Tokens.QUEST ? 1 : Infinity

            /**
             * check if there is a max definition (only when followed by a member/type, not ":", "=>", "..", etc.)
             */
            if (this.peekToken.Type === Tokens.NUMBER && this.isOccurrenceUpperBound(this.peekBelowToken)) {
                m = parseInt(this.peekToken.Literal, 10)
                this.nextToken()
            }

            occurrence = { n, m }
            this.nextToken()
        /**
         * numbered occurrence indicator, e.g.
         * ```
         *  1*10 bedroom: size,
         * ```
         */
        } else if (
            this.curToken.Type === Tokens.NUMBER &&
            this.peekToken.Type === Tokens.ASTERISK
        ) {
            const n = parseInt(this.curToken.Literal, 10)
            let m = Infinity
            this.nextToken() // eat "n"
            this.nextToken() // eat "*"

            /**
             * check if there is a max definition
             */
            if (this.curToken.Type === Tokens.NUMBER && this.isOccurrenceUpperBound(this.peekToken)) {
                m = parseInt(this.curToken.Literal, 10)
                this.nextToken()
            }

            occurrence = { n, m }
        }

        return occurrence
    }

    /**
     * check if line has a comment
     */
    private parseComment (isLeading?: boolean): Comment | undefined {
        if (this.curToken.Type !== Tokens.COMMENT) {
            return
        }
        const comment = this.curToken.Literal.replace(/^;(\s*)/, '')
        this.nextToken()

        if (comment.trim().length === 0) {
            return
        }

        return { Type: 'comment', Content: comment, Leading: Boolean(isLeading) }
    }

    parse () {
        const definition: Assignment[] = []

        while (this.curToken.Type !== Tokens.EOF) {
            const group = this.parseAssignments()
            if (group) {
                definition.push(group)
            }
        }

        return definition
    }

    private parserError (message: string) {
        const location = this.l.getLocation()
        const locInfo = this.l.getLocationInfo()
        return new Error(`${this.#filePath.replace(process.cwd(), '')}:${location.line + 1}:${location.position} - error: ${message}\n\n${locInfo}`)
    }
}
