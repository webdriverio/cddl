import baseConfig from '../../.release-it.base';
import type { Config } from 'release-it';

const config: Config = {
  ...baseConfig('cddl2java'),
};

console.log("Release-it config for cddl2java loaded", config);

export default config;
