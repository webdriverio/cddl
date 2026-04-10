CDDL to TypeScript
==================

> A Node.js package that can generate a TypeScript definition based on a CDDL file

CDDL expresses Concise Binary Object Representation (CBOR) data structures ([RFC 7049](https://tools.ietf.org/html/rfc7049)). Its main goal is to provide an easy and unambiguous way to express structures for protocol messages and data formats that use CBOR or JSON. This package allows you to transform a CDDL file into a TypeScript interface that you can use for other TypeScript projects.

## Install

To install this package run:

```sh
$ npm install cddl2ts
```

## Using this package

This package exposes a CLI as well as a programmatic interface for transforming CDDL into TypeScript.

### CLI

```sh
npx cddl2ts ./path/to/interface.cddl &> ./path/to/interface.ts
```

Generated interface fields default to `camelCase`. Pass `--field-case snake` to emit `snake_case` fields while keeping exported interface and type names unchanged.

```sh
npx cddl2ts ./path/to/interface.cddl --field-case snake &> ./path/to/interface.ts
```

### Programmatic Interface

The module exports a `transform` method that takes a CDDL AST object and returns a TypeScript definition as `string`, e.g.:

```js
import { parse, transform } from 'cddl'

/**
 * spec.cddl:
 *
 * session.CapabilityRequest = {
 *   ?acceptInsecureCerts: bool,
 *   ?browserName: text,
 *   ?browserVersion: text,
 *   ?platformName: text,
 * };
 */
const ast = parse('./spec.cddl')
const ts = transform(ast, { fieldCase: 'snake' })
console.log(ts)
/**
 * outputs:
 *
 * interface SessionCapabilityRequest {
 *   accept_insecure_certs?: boolean,
 *   browser_name?: string,
 *   browser_version?: string,
 *   platform_name?: string,
 * }
 */
```

---

If you are interested in this project, please feel free to contribute ideas or code patches. Have a look at our [contributing guidelines](https://github.com/webdriverio/cddl/blob/master/CONTRIBUTING.md) to get started.
