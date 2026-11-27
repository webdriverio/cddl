import { Token, Tokens } from './tokens.js';
import { isLetter, isAlphabeticCharacter, isDigit, isHexDigit } from './utils.js'
import { WHITESPACE_CHARACTERS } from './constants.js';

export default class Lexer {
    input: string
    position: number = 0
    readPosition: number = 0
    ch: number = 0
    hadLeadingWhitespace: boolean = false

    constructor (source: string) {
        this.input = source

        this.readChar()
    }

    private readChar (): void {
        if (this.readPosition >= this.input.length) {
            this.ch = 0
        } else {
            this.ch = this.input[this.readPosition].charCodeAt(0)
        }
        this.position = this.readPosition
        this.readPosition++
    }

    getLocation () {
        const position = this.position - 2
        const sourceLines = this.input.split('\n')
        const sourceLineLength = sourceLines.map((l) => l.length)
        let i = 0

        for (const [line, lineLength] of Object.entries(sourceLineLength)) {
            i += lineLength + 1
            if (i > position) {
                const lineBegin = i - lineLength
                return {
                    line: parseInt(line, 10),
                    position: position - lineBegin + 1
                }
            }
        }

        return { line: 0, position: 0 }
    }

    getLine (lineNumber: number) {
        return this.input.split('\n')[lineNumber]
    }

    getLocationInfo () {
        const loc = this.getLocation()
        const line = loc ? this.getLine(loc.line) : ''
        let locationInfo = line + '\n'
        locationInfo += ' '.repeat(loc?.position || 0) + '^\n'
        locationInfo += ' '.repeat(loc?.position || 0) + '|\n'
        return locationInfo
    }

    nextToken (): Token {
        let token: Token
        this.skipWhitespace()

        const Literal = String.fromCharCode(this.ch)
        switch (this.ch) {
            case '='.charCodeAt(0):
                token = { Type: Tokens.ASSIGN, Literal }
                break
            case '('.charCodeAt(0):
                token = { Type: Tokens.LPAREN, Literal }
                break
            case ')'.charCodeAt(0):
                token = { Type: Tokens.RPAREN, Literal }
                break
            case '{'.charCodeAt(0):
                token = { Type: Tokens.LBRACE, Literal }
                break
            case '}'.charCodeAt(0):
                token = { Type: Tokens.RBRACE, Literal }
                break
            case '['.charCodeAt(0):
                token = { Type: Tokens.LBRACK, Literal }
                break
            case ']'.charCodeAt(0):
                token = { Type: Tokens.RBRACK, Literal }
                break
            case '<'.charCodeAt(0):
                token = { Type: Tokens.LT, Literal }
                break
            case '>'.charCodeAt(0):
                token = { Type: Tokens.GT, Literal }
                break
            case '+'.charCodeAt(0):
                token = { Type: Tokens.PLUS, Literal }
                break
            case ','.charCodeAt(0):
                token = { Type: Tokens.COMMA, Literal }
                break
            case '.'.charCodeAt(0):
                token = { Type: Tokens.DOT, Literal }
                break
            case ':'.charCodeAt(0):
                token = { Type: Tokens.COLON, Literal }
                break
            case '?'.charCodeAt(0):
                token = { Type: Tokens.QUEST, Literal }
                break
            case '/'.charCodeAt(0):
                token = { Type: Tokens.SLASH, Literal }
                break
            case '*'.charCodeAt(0):
                token = { Type: Tokens.ASTERISK, Literal }
                break
            case '^'.charCodeAt(0):
                token = { Type: Tokens.CARET, Literal }
                break
            case '#'.charCodeAt(0):
                token = { Type: Tokens.HASH, Literal }
                break
            case '~'.charCodeAt(0):
                token = { Type: Tokens.TILDE, Literal }
                break
            case '"'.charCodeAt(0):
                token = { Type: Tokens.STRING, Literal: this.readString() }
                break
            case "'".charCodeAt(0):
                token = this.readBytes('')
                break
            case ';'.charCodeAt(0):
                token = { Type: Tokens.COMMENT, Literal: this.readComment() }
                break
            case 0:
                token = { Type: Tokens.EOF, Literal: '' }
                break
            default: {
                if ((Literal === 'h' || Literal === 'H') && this.input[this.readPosition] === "'") {
                    this.readChar() // move to opening '
                    const bytesToken = this.readBytes(Literal)
                    this.readChar() // eat closing '
                    return bytesToken
                } else if (this.input.slice(this.position, this.position + 4).toLowerCase() === "b64'") {
                    const prefix = this.input.slice(this.position, this.position + 3)
                    this.readChar()
                    this.readChar()
                    this.readChar() // move to opening '
                    const bytesToken = this.readBytes(prefix)
                    this.readChar() // eat closing '
                    return bytesToken
                } else if (isAlphabeticCharacter(Literal)) {
                    return { Type: Tokens.IDENT, Literal: this.readIdentifier() }
                } else if (
                    // positive number
                    isDigit(Literal) ||
                    // negative number
                    (this.ch === Tokens.MINUS.charCodeAt(0) && isDigit(this.input[this.readPosition]))
                ) {
                    return this.readNumberOrFloat()
                }
                token = { Type: Tokens.ILLEGAL, Literal: '' }
            }
        }

        this.readChar()
        return token
    }

    private readIdentifier (): string {
        const position = this.position

        /**
         * an identifier can contain
         * see https://tools.ietf.org/html/draft-ietf-cbor-cddl-08#section-3.1
         */
        while (
            // a letter (a-z, A-Z)
            isLetter(String.fromCharCode(this.ch)) ||
            // a digit (0-9)
            isDigit(String.fromCharCode(this.ch)) ||
            // and special characters (-, _, @, ., $)
            [
                Tokens.MINUS.charCodeAt(0),
                Tokens.UNDERSCORE.charCodeAt(0),
                Tokens.ATSIGN.charCodeAt(0),
                Tokens.DOT.charCodeAt(0),
                Tokens.DOLLAR.charCodeAt(0)
            ].includes(this.ch)
        ) {
            this.readChar()
        }

        return this.input.slice(position, this.position)
    }

    private readComment (): string {
        const position = this.position

        while (this.ch && String.fromCharCode(this.ch) !== '\n') {
            this.readChar()
        }

        return this.input.slice(position, this.position).trim()
    }

    private readString (): string {
        let result = ''

        this.readChar() // eat "
        while (this.ch && String.fromCharCode(this.ch) !== Tokens.QUOT) {
            // RFC 8610 SESC: a backslash escapes the single character that follows it, representing that character literally -- CDDL text strings have no JSON-style named escapes (\n, \t, \uXXXX and so on), the backslash exists only so a quote or a backslash itself can appear inside the literal. Consuming the escaped character here, rather than leaving both characters in the output verbatim, is what makes `\\+` in source read back as a single literal backslash followed by a plus instead of two backslashes -- the previous raw-slice implementation left the escape unresolved, so a caller re-embedding the value (e.g. building a RegExp source string from a `.regexp` control operator's value) double-escaped it.
            if (String.fromCharCode(this.ch) === '\\') {
                this.readChar() // eat the backslash
                if (this.ch) {
                    result += String.fromCharCode(this.ch)
                    this.readChar() // eat the escaped character
                }
                continue
            }

            result += String.fromCharCode(this.ch)
            this.readChar()
        }

        return result.trim()
    }

    private readBytes (prefix: string): Token {
        let result = ''

        this.readChar() // eat opening '
        while (this.ch && String.fromCharCode(this.ch) !== "'") {
            if (String.fromCharCode(this.ch) === '\\') {
                this.readChar()
                if (this.ch) {
                    result += String.fromCharCode(this.ch)
                    this.readChar()
                }
                continue
            }

            result += String.fromCharCode(this.ch)
            this.readChar()
        }

        if (String.fromCharCode(this.ch) !== "'") {
            return { Type: Tokens.ILLEGAL, Literal: '' }
        }

        return { Type: Tokens.BYTES, Literal: `${prefix}'${result}'` }
    }

    private readNumberOrFloat (): Token {
        const position = this.position

        if (this.ch === Tokens.MINUS.charCodeAt(0)) {
            this.readChar()
        }

        const nextChar = this.input[this.readPosition]
        if (this.ch === '0'.charCodeAt(0) && (nextChar === 'x' || nextChar === 'X')) {
            this.readChar() // eat 0
            this.readChar() // eat x/X
            while (isHexDigit(String.fromCharCode(this.ch))) {
                this.readChar()
            }

            if (
                this.ch === Tokens.DOT.charCodeAt(0) &&
                this.input[this.readPosition] !== '.' &&
                isHexDigit(this.input[this.readPosition])
            ) {
                this.readChar() // eat .
                while (isHexDigit(String.fromCharCode(this.ch))) {
                    this.readChar()
                }
            }

            if (this.ch === 'p'.charCodeAt(0) || this.ch === 'P'.charCodeAt(0)) {
                const afterP = this.input[this.readPosition]
                const expStarts = isDigit(afterP) ||
                    ((afterP === '+' || afterP === '-') && isDigit(this.input[this.readPosition + 1]))
                if (expStarts) {
                    this.readChar() // eat p/P
                    if (this.ch === Tokens.PLUS.charCodeAt(0) || this.ch === Tokens.MINUS.charCodeAt(0)) {
                        this.readChar()
                    }
                    while (isDigit(String.fromCharCode(this.ch))) {
                        this.readChar()
                    }
                    return { Type: Tokens.FLOAT, Literal: this.input.slice(position, this.position) }
                }
            }

            return { Type: Tokens.NUMBER, Literal: this.input.slice(position, this.position) }
        }

        if (this.ch === '0'.charCodeAt(0) && (nextChar === 'b' || nextChar === 'B')) {
            this.readChar() // eat 0
            this.readChar() // eat b/B
            while (isDigit(String.fromCharCode(this.ch))) {
                this.readChar()
            }
            return { Type: Tokens.NUMBER, Literal: this.input.slice(position, this.position) }
        }

        let isFloat = false
        while (isDigit(String.fromCharCode(this.ch))) {
            this.readChar()
        }

        // Stop before a `..` range operator instead of consuming the first dot.
        if (
            this.ch === Tokens.DOT.charCodeAt(0) &&
            this.input[this.readPosition] !== '.' &&
            isDigit(this.input[this.readPosition])
        ) {
            isFloat = true
            this.readChar() // eat .
            while (isDigit(String.fromCharCode(this.ch))) {
                this.readChar()
            }
        }

        if (this.ch === 'e'.charCodeAt(0) || this.ch === 'E'.charCodeAt(0)) {
            const afterE = this.input[this.readPosition]
            const expStarts = isDigit(afterE) ||
                ((afterE === '+' || afterE === '-') && isDigit(this.input[this.readPosition + 1]))
            if (expStarts) {
                isFloat = true
                this.readChar() // eat e/E
                if (this.ch === Tokens.PLUS.charCodeAt(0) || this.ch === Tokens.MINUS.charCodeAt(0)) {
                    this.readChar()
                }
                while (isDigit(String.fromCharCode(this.ch))) {
                    this.readChar()
                }
            }
        }

        return {
            Type: isFloat ? Tokens.FLOAT : Tokens.NUMBER,
            Literal: this.input.slice(position, this.position)
        }
    }

    private skipWhitespace () {
        const start = this.position
        while (WHITESPACE_CHARACTERS.includes(String.fromCharCode(this.ch))) {
            this.readChar()
        }
        this.hadLeadingWhitespace = this.position > start
    }
}
