import fs from 'node:fs'

import Lexer from './lexer.js'
import { Property } from './ast.js'
import { Token, Tokens } from './tokens.js';
import { PREDEFINED_IDENTIFIER, BOOLEAN_LITERALS } from './constants.js'
import { parseNumberValue } from './utils.js'
import {
    Type, PropertyName, PropertyType, PropertyReference, PropertyReferenceType,
    Variable, Range, RangePropertyReference, Occurrence, Assignment,
    Comment, Group, OperatorType, NativeTypeWithOperator, Operator
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
    #curPrecededBySpace = false;
    #peekPrecededBySpace = false;
    #peekBelowPrecededBySpace = false;

    constructor (filePath: string) {
        this.#filePath = filePath
        this.l = new Lexer(fs.readFileSync(filePath, 'utf-8'))

        this.nextToken()
        this.nextToken()
        this.nextToken()
    }

    private nextToken () {
        this.curToken = this.peekToken
        this.#curPrecededBySpace = this.#peekPrecededBySpace
        this.peekToken = this.peekBelowToken
        this.#peekPrecededBySpace = this.#peekBelowPrecededBySpace
        this.peekBelowToken = this.l.nextToken()
        this.#peekBelowPrecededBySpace = this.l.hadLeadingWhitespace
        return true
    }

    private skipComments () {
        while ((this.curToken.Type as string) === Tokens.COMMENT) {
            this.parseComment()
        }
    }

    private parseGenericParameters (): string[] {
        const params: string[] = []
        this.nextToken() // eat <
        this.skipComments()
        while ((this.curToken.Type as string) !== Tokens.GT) {
            if ((this.curToken.Type as string) !== Tokens.IDENT) {
                throw this.parserError(`Expected generic parameter identifier, received ${this.curToken.Type}(${this.curToken.Literal})`)
            }
            params.push(this.curToken.Literal)
            this.nextToken()
            this.skipComments()
            const nextType: string = this.curToken.Type
            if (nextType === Tokens.COMMA) {
                this.nextToken()
                this.skipComments()
                continue
            }
            if (nextType !== Tokens.GT) {
                throw this.parserError(`Expected "," or ">" in generic parameters, received ${this.curToken.Type}(${this.curToken.Literal})`)
            }
        }
        this.nextToken() // eat >
        return params
    }

    private parseInlineAlternative (): PropertyType[] {
        const val = this.parseAssignmentValue()
        const operator = this.isOperator() ? this.parseOperator() : undefined
        if (!operator) {
            return Array.isArray(val) ? val : [val]
        }
        if (Array.isArray(val)) {
            return [...val.slice(0, -1), { Type: val[val.length - 1], Operator: operator } as NativeTypeWithOperator]
        }
        return [{ Type: val as NativeTypeWithOperator['Type'], Operator: operator }]
    }

    private parseGenericArguments (): (PropertyType | PropertyType[])[] {
        const args: (PropertyType | PropertyType[])[] = []
        this.nextToken() // eat <
        this.skipComments()
        while ((this.curToken.Type as string) !== Tokens.GT) {
            const argTypes: PropertyType[] = []
            while (true) {
                this.skipComments()
                if (
                    this.curToken.Type === Tokens.LBRACE ||
                    this.curToken.Type === Tokens.LBRACK ||
                    this.curToken.Type === Tokens.LPAREN
                ) {
                    argTypes.push(...this.parseInlineAlternative())
                } else {
                    let item: PropertyType = this.parsePropertyType()
                    if (this.isOperator()) {
                        item = { Type: item, Operator: this.parseOperator() } as NativeTypeWithOperator
                    } else if ((this.curToken.Type as string) !== Tokens.SLASH) {
                        this.nextToken()
                    }
                    argTypes.push(item)
                }
                this.skipComments()
                if ((this.curToken.Type as string) === Tokens.SLASH && this.peekToken.Type !== Tokens.SLASH) {
                    this.nextToken() // eat /
                    continue
                }
                break
            }
            args.push(argTypes.length === 1 ? argTypes[0] : argTypes)
            this.skipComments()
            if ((this.curToken.Type as string) === Tokens.COMMA) {
                this.nextToken() // eat ,
                this.skipComments()
                continue
            }
            if ((this.curToken.Type as string) !== Tokens.GT) {
                throw this.parserError(`Expected "," or ">" in generic arguments, received ${this.curToken.Type}(${this.curToken.Literal})`)
            }
        }
        return args
    }

    private formatMemberKey (memberType: PropertyType, fallback: string): string {
        if (typeof memberType === 'object' && 'Type' in memberType && memberType.Type === 'range') {
            const range = memberType.Value as Range
            const formatBound = (bound: unknown): string =>
                typeof bound === 'object' && bound !== null && 'Value' in bound
                    ? String((bound as { Value: unknown }).Value)
                    : String(bound)
            return `${formatBound(range.Min)}${range.Inclusive ? '..' : '...'}${formatBound(range.Max)}`
        }
        return fallback
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
         * groupName<t> =
         * groupName /=
         * groupName //=
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

        let genericParameters: string[] | undefined
        if ((this.curToken.Type as string) === Tokens.LT) {
            genericParameters = this.parseGenericParameters()
        }

        const opType: string = this.curToken.Type
        if (opType !== Tokens.ASSIGN && opType !== Tokens.SLASH) {
            throw this.parserError(`group identifier expected, received "${JSON.stringify(this.curToken)}"`)
        }

        if ((this.curToken.Type as string) === Tokens.SLASH) {
            isChoiceAddition = true
            this.nextToken() // eat `/`
        }

        if ((this.curToken.Type as string) === Tokens.SLASH) {
            this.nextToken() // eat `/`
        }

        this.nextToken() // eat `=`
        const assignmentValue = this.parseAssignmentValue(groupName, isChoiceAddition) as Assignment
        if (genericParameters && genericParameters.length > 0) {
            assignmentValue.GenericParameters = genericParameters
        }

        while ((this.curToken.Type as string) === Tokens.COMMENT) {
            const comment = this.parseComment()
            comment && comments.push(comment)
        }
        assignmentValue.Comments = comments
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
        if (
            closingTokens.length === 1 &&
            this.peekToken.Type === Tokens.DOT &&
            (this.peekBelowToken.Type !== Tokens.DOT || closingTokens[0] === Tokens.RPAREN)
        ) {
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

            /**
             * check if we are in an array and a new item is indicated
             */
            if (this.curToken.Literal === Tokens.COMMA && closingTokens[0] === Tokens.RBRACK) {
                this.nextToken()
                continue
            }

            const isMemberValueStart =
                this.curToken.Type === Tokens.NUMBER ||
                this.curToken.Type === Tokens.FLOAT ||
                this.curToken.Type === Tokens.BYTES ||
                (this.curToken.Type === Tokens.IDENT && (
                    this.peekToken.Type === Tokens.LT ||
                    (this.peekToken.Type === Tokens.DOT && this.peekBelowToken.Type === Tokens.DOT)
                ))

            if (isMemberValueStart) {
                const rawKeyLiteral = this.curToken.Literal
                let memberType: PropertyType = this.parsePropertyType(isUnwrapped)
                if (!this.isOperator()) {
                    this.nextToken()
                }

                if (
                    this.curToken.Type === Tokens.COLON ||
                    this.curToken.Type === Tokens.CARET ||
                    (this.curToken.Type === Tokens.ASSIGN && this.peekToken.Type === Tokens.GT)
                ) {
                    propertyName = this.formatMemberKey(memberType, rawKeyLiteral)
                } else {
                    const memberTypes: PropertyType[] = []
                    if (this.isOperator()) {
                        memberType = {
                            Type: memberType,
                            Operator: this.parseOperator()
                        } as NativeTypeWithOperator
                    }
                    memberTypes.push(memberType)

                    while (this.curToken.Type === Tokens.SLASH && this.peekToken.Type !== Tokens.SLASH) {
                        this.nextToken()
                        this.skipComments()
                        if (
                            (this.curToken.Type as string) === Tokens.LBRACE ||
                            (this.curToken.Type as string) === Tokens.LBRACK ||
                            (this.curToken.Type as string) === Tokens.LPAREN
                        ) {
                            memberTypes.push(...this.parseInlineAlternative())
                        } else {
                            let alt: PropertyType = this.parsePropertyType()
                            if (this.isOperator()) {
                                alt = { Type: alt, Operator: this.parseOperator() } as NativeTypeWithOperator
                            } else if ((this.curToken.Type as string) !== Tokens.SLASH) {
                                this.nextToken()
                            }
                            memberTypes.push(alt)
                        }
                    }

                    let hadComma = false
                    if ((this.curToken.Type as string) === Tokens.COMMA) {
                        hadComma = true
                        this.nextToken()
                    }
                    const trailingComment = this.parseComment()
                    if (trailingComment) {
                        comments.push(trailingComment)
                    }

                    const prop: Property = {
                        HasCut: hasCut,
                        Occurrence: occurrence,
                        Name: '',
                        Type: memberTypes,
                        Comments: comments
                    }

                    if (isChoice) {
                        (valuesOrProperties[valuesOrProperties.length - 1] as Property[]).push(prop)
                    } else {
                        valuesOrProperties.push(prop)
                    }
                    if (hadComma) {
                        isChoice = false
                    }
                    continue
                }
            } else {
                propertyName = this.parsePropertyName()
            }

            /**
             * an unnamed member decorated with an operator, e.g. `[ bstr .size 3, bstr ]` -- there is no colon here, so this must be handled before the colon-expecting path below ever sees it
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

                valuesOrProperties.push({
                    HasCut: hasCut,
                    Occurrence: occurrence,
                    Name: '',
                    Type: [{ ...baseType, Operator: operator }],
                    Comments: []
                })

                if (this.curToken.Type === Tokens.COMMA) {
                    this.nextToken()
                }
                continue
            }

            /**
             * if `,` is found we have a group reference and jump to the next line
             */
            if (this.curToken.Type === Tokens.COMMA || closingTokens.includes(this.curToken.Type)) {
                const tokenType = this.curToken.Type
                let parsedComments = false
                let comment: Comment | undefined

                /**
                 * check if line has a comment
                 */
                if (this.curToken.Type === Tokens.COMMA && this.peekToken.Type === Tokens.COMMENT) {
                    this.nextToken()
                    comment = this.parseComment()
                    parsedComments = true
                }

                valuesOrProperties.push({
                    HasCut: hasCut,
                    Occurrence: occurrence,
                    Name: '',
                    Type: PREDEFINED_IDENTIFIER.includes(propertyName)
                        ? propertyName
                        : [{
                            Type: 'group' as PropertyReferenceType,
                            Value: propertyName,
                            Unwrapped: isUnwrapped
                        }],
                    Comments: comment ? [comment] : []
                })

                if (this.curToken.Literal === Tokens.COMMA || this.curToken.Literal === closingTokens[0]) {
                    if (this.curToken.Literal === Tokens.COMMA) {
                        this.nextToken()
                    }
                    continue
                }

                if (!parsedComments) {
                    this.nextToken()
                }

                /**
                 * only continue if next token contains a comma
                 */
                if (tokenType === Tokens.COMMA) {
                    continue
                }

                /**
                 * otherwise break
                 */
                break
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

            const prop = {
                HasCut: hasCut,
                Occurrence: occurrence,
                Name: propertyName,
                Type: propertyType,
                Comments: comments,
                ...(operator ? { Operator: operator } : {})
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

    private parsePropertyType (initialUnwrapped = false): PropertyType {
        let type: PropertyType | undefined = undefined
        let isUnwrapped = initialUnwrapped
        let isGroupedRange = false

        /**
         * check if variable name is unwrapped
         */
        if (this.curToken.Literal === Tokens.TILDE) {
            isUnwrapped = true
            this.nextToken() // eat ~
        }

        /**
         * a quoted string is always a literal, even if its text matches a
         * reserved keyword like "null" or "bool"
         */
        switch (this.curToken.Type === Tokens.STRING ? Tokens.STRING : this.curToken.Literal) {
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
                    type = {
                        Type: 'literal' as PropertyReferenceType,
                        Value: this.curToken.Literal,
                        Unwrapped: isUnwrapped,
                        IsBytes: true
                    }
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
                    const ident = this.curToken.Literal
                    let genericArguments: (PropertyType | PropertyType[])[] | undefined
                    if (this.peekToken.Type === Tokens.LT) {
                        this.nextToken() // move to <
                        genericArguments = this.parseGenericArguments()
                    }
                    type = {
                        Type: 'group' as PropertyReferenceType,
                        Value: ident,
                        Unwrapped: isUnwrapped,
                        ...(genericArguments ? { GenericArguments: genericArguments } : {})
                    } as PropertyReference
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
                } else if (this.curToken.Literal === Tokens.LPAREN && this.peekToken.Type === Tokens.NUMBER) {
                    this.nextToken()
                    type = {
                        Type: 'literal' as PropertyReferenceType,
                        Value: parseNumberValue(this.curToken),
                        Unwrapped: isUnwrapped
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
             * RFC 8610 Appendix B `occur = [uint] "*" [uint]`: only `*` takes an upper
             * bound and it must be adjacent (no whitespace), so `* 3 .. 255 => int`
             * does not consume `3` as an occurrence bound.
             */
            if (
                this.curToken.Type === Tokens.ASTERISK &&
                this.peekToken.Type === Tokens.NUMBER &&
                !this.#peekPrecededBySpace
            ) {
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
            this.peekToken.Type === Tokens.ASTERISK &&
            !this.#peekPrecededBySpace
        ) {
            const n = parseInt(this.curToken.Literal, 10)
            let m = Infinity
            this.nextToken() // eat "n"
            this.nextToken() // eat "*"

            /**
             * check if there is a max definition
             */
            if (this.curToken.Type === Tokens.NUMBER && !this.#curPrecededBySpace) {
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
