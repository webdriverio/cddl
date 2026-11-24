import { describe, it, expect } from 'vitest'

import { Tokens } from '../src/tokens.js'
import Lexer from '../src/lexer.js'

describe('lexer', () => {
    it('should allow to read token', () => {
        const input = '=+(){},/<>'
        const tests = [
            [Tokens.ASSIGN, '='],
            [Tokens.PLUS, '+'],
            [Tokens.LPAREN, '('],
            [Tokens.RPAREN, ')'],
            [Tokens.LBRACE, '{'],
            [Tokens.RBRACE, '}'],
            [Tokens.COMMA, ','],
            [Tokens.SLASH, '/'],
            [Tokens.LT, '<'],
            [Tokens.GT, '>']
        ]

        const l = new Lexer(input)
        for (const [Type, Literal] of tests) {
            const token = l.nextToken()
            expect(token.Type).toBe(Type)
            expect(token.Literal).toBe(Literal)
        }
    })

    it('should resolve a backslash-escaped character inside a string literal to that literal character (RFC 8610 SESC)', () => {
        const input = String.raw`"[0-9a-f]{64}\\+[0-9a-f]{64}" "she said \"hi\"" "a\\b" "escaped plus \+ is just a plus"`
        const tests = [
            [Tokens.STRING, '[0-9a-f]{64}\\+[0-9a-f]{64}'],
            [Tokens.STRING, 'she said "hi"'],
            [Tokens.STRING, 'a\\b'],
            [Tokens.STRING, 'escaped plus + is just a plus']
        ]

        const l = new Lexer(input)
        for (const [Type, Literal] of tests) {
            const token = l.nextToken()
            expect(token.Type).toBe(Type)
            expect(token.Literal).toBe(Literal)
        }
    })

    it('should read identifiers and comments', () => {
        const input = '   headers,       ; Headers for the recipient'
        const tests = [
            [Tokens.IDENT, 'headers'],
            [Tokens.COMMA, ','],
            [Tokens.COMMENT, '; Headers for the recipient']
        ]

        const l = new Lexer(input)
        for (const [Type, Literal] of tests) {
            const token = l.nextToken()
            expect(token.Type).toBe(Type)
            expect(token.Literal).toBe(Literal)
        }
    })

    it('should correctly report location info', () => {
        const input = 'a = 1'
        const l = new Lexer(input)

        // consume tokens until EOF
        while (l.nextToken().Type !== 'EOF') {}

        // consume more EOFs to push position further
        for (let i = 0; i < 10; ++i) {
            l.nextToken()
        }

        // This should trigger the fallback
        const locEnd = l.getLocation()
        expect(locEnd.line).toBe(0)
        expect(locEnd.position).toBe(0)
    })

    it('should render caret location info for the current line', () => {
        const l = new Lexer('foo\nbar')
        l.nextToken()

        expect(l.getLine(1)).toBe('bar')
        expect(l.getLocationInfo()).toBe('foo\n ^\n |\n')
    })

    it('should tokenize hex floats, scientific exponents, and hex/binary integers without consuming ranges', () => {
        const input = '0x1.8p1 -0x1.8p-2 0x1p0 0xdead 1e5 1.5e-2 0x1..0xff 0b1010'
        const tests = [
            [Tokens.FLOAT, '0x1.8p1'],
            [Tokens.FLOAT, '-0x1.8p-2'],
            [Tokens.FLOAT, '0x1p0'],
            [Tokens.NUMBER, '0xdead'],
            [Tokens.FLOAT, '1e5'],
            [Tokens.FLOAT, '1.5e-2'],
            [Tokens.NUMBER, '0x1'],
            [Tokens.DOT, '.'],
            [Tokens.DOT, '.'],
            [Tokens.NUMBER, '0xff'],
            [Tokens.NUMBER, '0b1010']
        ]

        const l = new Lexer(input)
        for (const [Type, Literal] of tests) {
            const token = l.nextToken()
            expect(token.Type).toBe(Type)
            expect(token.Literal).toBe(Literal)
        }
    })

    it('should tokenize RFC 8610 byte string literals with qualifiers and escapes', () => {
        const input = String.raw`h'0102' H'0a 0b' b64'AQID' B64'AA==' 'raw' 'it\'s\\ok' 'unterminated`
        const tests = [
            [Tokens.BYTES, "h'0102'"],
            [Tokens.BYTES, "H'0a 0b'"],
            [Tokens.BYTES, "b64'AQID'"],
            [Tokens.BYTES, "B64'AA=='"],
            [Tokens.BYTES, "'raw'"],
            [Tokens.BYTES, "'it's\\ok'"],
            [Tokens.BYTES, "'unterminated"]
        ]

        const l = new Lexer(input)
        for (const [Type, Literal] of tests) {
            const token = l.nextToken()
            expect(token.Type).toBe(Type)
            expect(token.Literal).toBe(Literal)
        }
    })
})
