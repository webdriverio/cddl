import baseConfig from '../../.release-it.base';
import type { Config } from 'release-it';

const config: Config = {
  ...baseConfig('cddl2swift'),
};

console.log("Release-it config for cddl2swift loaded", config);

export default config;
