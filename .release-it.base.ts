import type { Config } from 'release-it';

const baseConfig = (name: string): Config => ({
  plugins: {
    "release-it-pnpm": {
      // Disable the release step here to skip changelogithub and use `conventional-changelog` instead.
      disableRelease: true,
    },
    "@release-it/conventional-changelog": {
      infile: false,
      // This mimics changelogithub categories/emojis
      preset: {
        name: "conventionalcommits",
        types: [
          { type: "feat", section: "🚀 Features" },
          { type: "fix", section: "🐞 Bug Fixes" },
          { type: "perf", section: "🏎 Performance" },
          { type: "chore", section: "🏡 Other Changes" },
          { type: "docs", section: "🏡 Other Changes" },
          { type: "refactor", section: "🏡 Other Changes" },
          { type: "test", section: "🏡 Other Changes" },
          { type: "ci", section: "🏡 Other Changes" },
          { type: "style", section: "🏡 Other Changes" },
          { type: "build", section: "🏡 Other Changes" },
          { type: "revert", section: "🏡 Other Changes" },
          { type: "ops", section: "🏡 Other Changes" },
        ],
      },
      // This maps the breaking change (eg. `!` like `feat!: ...`) section to your custom title
      presetConfig: {
         header: "🚨 Breaking Changes"
      },
      // Path filtering that changelogithub does not support for scoped release notes per package.
      gitRawCommitsOpts: {
        path: [".", "../../tsconfig.json"]
      }
    }
  },
  git: {
    requireCleanWorkingDir: false,
    addUntrackedFiles: true,
    tagName: `${name}-v\${version}`,
    commitMessage: `chore(${name}): release v\${version}`,
  },
  github: {
    release: true,
    releaseName: `${name} \${version}`,
  }
});

export default baseConfig;
