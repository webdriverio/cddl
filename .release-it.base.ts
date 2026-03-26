import type { Config } from 'release-it';

const baseConfig = (name: string): Config => ({
  plugins: {
    "release-it-pnpm": {}
  },
  git: {
    requireCleanWorkingDir: false,
    addUntrackedFiles: true,
    // Must be overriden by each package to have seperate tags and changelogs
    tagName: `${name}-v\${version}`,
    commitMessage: `chore(${name}): release v\${version}`,
    changelog: 'git log --pretty=format:"* %s (%h)" ${latestTag ? latestTag + "..HEAD" : ""} -- . ../../tsconfig.json'
  },
  github: {
    release: true,
  }
});

export default baseConfig;
