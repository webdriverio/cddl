import { ChangelogOptions } from "changelogithub";

const baseConfig = (name: string): ChangelogOptions => ({
  name,
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
  },
  tagFilter: (tag) => tag.startsWith(`${name}-v`),
})

export default baseConfig;
