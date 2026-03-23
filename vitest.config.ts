import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        include: ['packages/*/tests/**/*.test.ts'],
        coverage: {
            enabled: true,
            provider: 'v8',
            include: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.js'],
            thresholds: {
                statements: 93.5,
                functions: 90.2,
                branches: 92.8,
                lines: 93.6,
            }
        }
    }
})
