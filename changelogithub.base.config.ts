import { defineConfig } from 'changelogithub'

export default defineConfig({
  types: {
    feat: { title: '🚀 Features' },
    fix: { title: '🐞 Bug Fixes' },
    perf: { title: '🏎 Performance' },
    chore: { title: '🏡 Other Changes' },
    docs: { title: '🏡 Other Changes' },
    refactor: { title: '🏡 Other Changes' }
  },
  titles: {
    breakingChanges: '🚨 Breaking Changes'
  }
})
