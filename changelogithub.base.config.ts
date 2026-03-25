import { defineConfig } from 'changelogithub'

export default defineConfig({
  types: {
    feat: { title: '### &nbsp;&nbsp;&nbsp;🚀 Features' },
    fix: { title: '### &nbsp;&nbsp;&nbsp;🐞 Bug Fixes' },
    perf: { title: '### &nbsp;&nbsp;&nbsp;🏎 Performance' },
    chore: { title: '### &nbsp;&nbsp;&nbsp;🏡 Other Changes' },
    docs: { title: '### &nbsp;&nbsp;&nbsp;🏡 Other Changes' },
    refactor: { title: '### &nbsp;&nbsp;&nbsp;🏡 Other Changes' }
  },
  titles: {
    breakingChanges: '### &nbsp;&nbsp;&nbsp;🚨 Breaking Changes'
  }
})
