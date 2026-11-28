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

    it('should lex hex floats, scientific floats, hex/binary integers, and ranges', () => {
        const input = '0x1.8p1 -0x1.fp+3 0X1p-2 0x1a 0b10 1e5 1.5e-2 0..10 0.0..1.0'
        const expected = [
            [Tokens.FLOAT, '0x1.8p1'],
            [Tokens.FLOAT, '-0x1.fp+3'],
            [Tokens.FLOAT, '0X1p-2'],
            [Tokens.NUMBER, '0x1a'],
            [Tokens.NUMBER, '0b10'],
            [Tokens.FLOAT, '1e5'],
            [Tokens.FLOAT, '1.5e-2'],
            [Tokens.NUMBER, '0'],
            [Tokens.DOT, '.'],
            [Tokens.DOT, '.'],
            [Tokens.NUMBER, '10'],
            [Tokens.FLOAT, '0.0'],
            [Tokens.DOT, '.'],
            [Tokens.DOT, '.'],
            [Tokens.FLOAT, '1.0'],
        ]

        const l = new Lexer(input)
        for (const [Type, Literal] of expected) {
            expect(l.nextToken()).toEqual({ Type, Literal })
        }
    })

    it('should lex byte string literals without shadowing h/b64 identifiers', () => {
        const input = String.raw`h'0102' H'ab cd' b64'AQID' B64'AQID' 'a\'b\\c' h header b64url`
        const expected = [
            [Tokens.BYTES, "h'0102'"],
            [Tokens.BYTES, "H'ab cd'"],
            [Tokens.BYTES, "b64'AQID'"],
            [Tokens.BYTES, "B64'AQID'"],
            [Tokens.BYTES, "'a'b\\c'"],
            [Tokens.IDENT, 'h'],
            [Tokens.IDENT, 'header'],
            [Tokens.IDENT, 'b64url'],
        ]

        const l = new Lexer(input)
        for (const [Type, Literal] of expected) {
            expect(l.nextToken()).toEqual({ Type, Literal })
        }
    })

    it('should return ILLEGAL for an unterminated byte string literal', () => {
        const l = new Lexer("h'0102")
        expect(l.nextToken()).toEqual({ Type: Tokens.ILLEGAL, Literal: '' })
    })
})
