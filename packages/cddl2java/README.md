CDDL to Java [![Test](https://github.com/christian-bromann/cddl2java/actions/workflows/test.yml/badge.svg)](https://github.com/christian-bromann/cddl2java/actions/workflows/test.yml)
==================

> A Node.js package that can generate a Java classes based on a CDDL file

CDDL expresses Concise Binary Object Representation (CBOR) data structures ([RFC 7049](https://tools.ietf.org/html/rfc7049)). Its main goal is to provide an easy and unambiguous way to express structures for protocol messages and data formats that use CBOR or JSON. This package allows you to transform a CDDL file into Java classes.

Related projects:
- [christian-bromann/cddl](https://github.com/christian-bromann/cddl): parses CDDL into an AST
- [christian-bromann/cddl2ts](https://github.com/christian-bromann/cddl2ts): parses CDDL into TypeScript interfaces

## Install

To install this package run:

```sh
$ npm install cddl2java
```

## Using this package

This package exposes a CLI as well as a programmatic interface for transforming CDDL into TypeScript.

### CLI

```sh
npx cddl2java ./path/to/interface.cddl ./outputDir
```

## Development

To work on this project you have to have Node.js installed. It is recommend to use [`nvm`](https://github.com/nvm-sh/nvm) to install the right version via:

```sh
# install nvm.sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
```

Then switch to the appropiate Node.js versio:

```sh
nvm use
```

The following commands are set up to work with the project:

- `npm run build`: build the project so you can update the test fixtures, e.g. via `./bin/cddl2java.js tests/bidi.cddl ./tests/__fixtures__/`
- `npm run watch`: auto-compile TypeScript files for development
- `npm run test`: run the tests

### Testing

You can find a current working WebDriver Bidi file in [`tests/bidi.cddl`](./tests/bidi.cddl) that we are using to verify the output. The current output for given file is located in [`tests/__fixtures__`](./tests/__fixtures__). Check above command to run the test.

---

If you are interested in this project, please feel free to contribute ideas or code patches. Have a look at our [contributing guidelines](https://github.com/christian-bromann/cddl2java/blob/master/CONTRIBUTING.md) to get started.
