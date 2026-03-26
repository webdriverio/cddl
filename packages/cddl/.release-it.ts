import baseConfig from '../../.release-it.base';
import type { Config } from 'release-it';

const config: Config = {
  ...baseConfig,
  git: {
    ...baseConfig.git,
    // Must be overriden by each package to have seperate tags and changelogs
    tagName: "cddl-v${version}",
    tagMatch: "cddl-v[0-9]*",
    commitMessage: "chore(cddl): release v${version}",
  },
};

export default config;
