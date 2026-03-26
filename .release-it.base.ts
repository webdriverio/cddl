import type { Config } from 'release-it';

const baseConfig = (name: string): Config => ({
  plugins: {
    "release-it-pnpm": {
      // Disable the release step here so we can use the native one below
      disableRelease: true,
    }
  },
  git: {
    requireCleanWorkingDir: false,
    addUntrackedFiles: true,
    tagName: `${name}-v\${version}`,
    commitMessage: `chore(${name}): release v\${version}`,
    // This filtered command WILL be used by the native github plugin
    changelog: 'git log --pretty=format:"* %s (%h)" ${latestTag ? latestTag + "..HEAD" : ""} -- . ../../tsconfig.json'
  },
  github: {
    release: true,
    // explicitly null ensures it uses the git.changelog output defined above
    releaseNotes: null,
    releaseName: `${name}-v\${version}`,
  }
});

export default baseConfig;
