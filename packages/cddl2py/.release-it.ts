import baseConfig from '../../.release-it.base';
import type { Config } from 'release-it';

const config: Config = {
  ...baseConfig('cddl2py'),
};

console.log("Release-it config for cddl2py loaded", config);

export default config;

