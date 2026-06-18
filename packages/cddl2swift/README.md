# CDDL to Swift

> Generate Swift type definitions from CDDL as `struct`s, `typealias`es and `enum`s.

`cddl2swift` converts a parsed CDDL schema into Swift source code. Groups become
`struct`s, named assignments become `typealias`es, and choices become `enum`s.

## Install

Use the CLI:

```sh
npm install cddl2swift
```

Use the programmatic API:

```sh
npm install cddl cddl2swift
```

## What It Generates

`cddl2swift` maps common CDDL constructs into idiomatic Swift, including:

- named CDDL assignments to `typealias` declarations
- groups to `struct` declarations
- optional group fields to Swift optionals (`T?`)
- arrays to `[T]`
- record groups (`*text => T`) to `[String: T]`
- string-literal choices to raw-value backed `enum`s (`enum X: String, Codable`)
- choices of named types to `enum`s with associated values

It also normalizes names for Swift code by turning type names into `PascalCase`
and field names into `camelCase`, escaping Swift keywords with backticks.

Because Swift has no structural union or intersection types, inline unions of
more than one concrete type fall back to `Any`, and group mixins (unnamed group
references) are flattened by inlining the referenced group's fields.

## CLI

The CLI reads a CDDL file and writes generated Swift code to stdout, so the
normal workflow is to redirect the output into a `.swift` file.

```sh
npx cddl2swift ./path/to/schema.cddl > ./Types.swift
```

Show help:

```sh
npx cddl2swift --help
```

## Programmatic API

The package exports a single `transform()` function. It accepts the parsed CDDL
AST and returns the generated Swift source as a string.

```js
import { parse } from 'cddl'
import { transform } from 'cddl2swift'

const ast = parse('./schema.cddl')
const swift = transform(ast)

console.log(swift)
```

## Example

Input CDDL:

```cddl
person = {
  name: tstr,
  age: uint,
  ?nickname: tstr,
}
```

Generated Swift:

```swift
public struct Person {
    public var name: String
    public var age: Int
    public var nickname: String?
}
```

## Notes

- Generated files include a header comment with the `cddl2swift` version used.
- The CLI validates that the input file exists before attempting to parse it.

---

If you want to contribute fixes or improvements, see the repository
[contributing guide](https://github.com/webdriverio/cddl/blob/main/CONTRIBUTING.md).
