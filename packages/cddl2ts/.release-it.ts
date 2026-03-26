import baseConfig from '../../.release-it.base';
import type { Config } from 'release-it';

const config: Config = {
  ...baseConfig,
  git: {
    ...baseConfig.git,
    // Must be overriden by each package to have seperate tags and changelogs
    tagName: "cddl2ts-v${version}",
    tagMatch: "cddl2ts-v[0-9]*",
    commitMessage: "chore(cddl2ts): release v${version}",
  },
};

export default config;
