CDDL [![Test](https://github.com/webdriverio/cddl/actions/workflows/test.yml/badge.svg)](https://github.com/webdriverio/cddl/actions/workflows/test.yml)
====

> Concise data definition language ([RFC 8610](https://tools.ietf.org/html/rfc8610)) implementation for JSON validator & code generator in Node.js

CDDL expresses Concise Binary Object Representation (CBOR) data structures ([RFC 7049](https://tools.ietf.org/html/rfc7049)). Its main goal is to provide an easy and unambiguous way to express structures for protocol messages and data formats that use CBOR or JSON.

There are also CDDL parsers for other languages:
- Rust: [anweiss/cddl](https://github.com/anweiss/cddl)

The package is currently mostly used to help generate typed interfaces for the WebDriver Bidi specification in the following projects:
- [WebdriverIO](https://webdriver.io) - via the [`cddl2ts`](https://www.npmjs.com/package/cddl2ts) package and [this script](https://github.com/webdriverio/webdriverio/blob/a2ae35332f9b3fc9490136df1ac3d2e14c1e35b6/scripts/bidi/index.ts)
- [Selenium](https://selenium.dev) - via the [`cddl2java`](https://github.com/webdriverio/cddl2java) package

__Note:__ this is __work in progress__, feel free to have a look at the code or contribute but don't use this for anything yet!

## Install

To install one of the packages run:

```sh
# Parser & validator
$ npm install cddl

# Generate typescript definition
$ npm install cddl2ts
```

## Using packages

The packages expose a CLI as well as a programmatic interface for parsing and transforming CDDL.

### CLI

The `cddl` CLI offers a `validate` command that helps identify invalid CDDL formats, e.g.:

```sh
npx cddl validate ./path/to/interface.cddl
✅ Valid CDDL file!
```

The `cddl2ts` CLI allows transforming CDDL into TypeScript:

```sh
npx cddl2ts ./path/to/interface.cddl &> ./path/to/interface.ts
```

### Programmatic Interface

You can import any of the packages into your typescript project for an easy integration
- [`cddl` example](packages/cddl/README.md#programmatic-interface)
- [`cddl2ts` example](packages/cddl2ts/README.md#programmatic-interface)

---

If you are interested in this project, please feel free to contribute ideas or code patches. Have a look at our [contributing guidelines](https://github.com/webdriverio/cddl/blob/master/CONTRIBUTING.md) to get started.
