import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        include: ['packages/*/tests/**/*.test.ts'],
        coverage: {
            enabled: true,
            provider: 'v8',
            include: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.js'],
            thresholds: {
                lines: 87.6,
                functions: 92.5,
                statements: 85.7,
                branches: 78.0,
                'packages/cddl/**/*': {
                    lines: 96.0,
                    functions: 97.5,
                    statements: 96.0,
                    branches: 93.0,
                },
                'packages/cddl2ts/**/*': {
                    lines: 74.4,
                    functions: 87.1,
                    statements: 71.3,
                    branches: 63.4,
                },
                'packages/cddl2java/**/*': {
                    lines: 97.7,
                    functions: 94.8,
                    statements: 97.1,
                    branches: 91.5,
                }
            }
        }
    }
})
