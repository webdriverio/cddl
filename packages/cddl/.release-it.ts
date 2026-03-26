import baseConfig from '../../.release-it.base';
import type { Config } from 'release-it';

const config: Config = {
  ...baseConfig('cddl'),
};

console.log("Release-it config for cddl loaded", config);

export default config;
