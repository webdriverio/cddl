import baseConfig from '../../.release-it.base';
import type { Config } from 'release-it';

const config: Config = {
  ...baseConfig('cddl2ts'),
};

console.log("Release-it config for cddl2ts loaded", config);

export default config;

