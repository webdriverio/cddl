# CDDL to Kotlin

> Generate Kotlin type definitions from CDDL as `data class`es, `typealias`es and `enum`s.

`cddl2kotlin` converts a parsed CDDL schema into Kotlin source code. Groups become
`data class`es, named assignments become `typealias`es, and choices become
`enum class`es or `sealed interface`s.

## Install

Use the CLI:

```sh
npm install cddl2kotlin
```

Use the programmatic API:

```sh
npm install cddl cddl2kotlin
```

## What It Generates

`cddl2kotlin` maps common CDDL constructs into idiomatic Kotlin, including:

- named CDDL assignments to `typealias` declarations
- groups to `data class` declarations (empty groups become a plain `class`)
- optional group fields to nullable types with a `= null` default
- arrays to `List<T>`
- record groups (`*text => T`) to `Map<String, T>`
- string-literal choices to `enum class` declarations
- choices of named types to `sealed interface`s with wrapper `data class`es

It also normalizes names for Kotlin code by turning type names into `PascalCase`,
field names into `camelCase` (escaping Kotlin keywords with backticks) and enum
constants into `UPPER_SNAKE_CASE`.

Because Kotlin has no structural union or intersection types, inline unions of
more than one concrete type fall back to `Any?`, and group mixins (unnamed group
references) are flattened by inlining the referenced group's fields.

## CLI

The CLI reads a CDDL file and writes generated Kotlin code to stdout, so the
normal workflow is to redirect the output into a `.kt` file.

```sh
npx cddl2kotlin ./path/to/schema.cddl > ./Types.kt
```

Show help:

```sh
npx cddl2kotlin --help
```

## Programmatic API

The package exports a single `transform()` function. It accepts the parsed CDDL
AST and returns the generated Kotlin source as a string.

```js
import { parse } from 'cddl'
import { transform } from 'cddl2kotlin'

const ast = parse('./schema.cddl')
const kotlin = transform(ast)

console.log(kotlin)
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

Generated Kotlin:

```kotlin
data class Person(
    val name: String,
    val age: Long,
    val nickname: String? = null
)
```

## Notes

- Generated files include a header comment with the `cddl2kotlin` version used.
- The CLI validates that the input file exists before attempting to parse it.

---

If you want to contribute fixes or improvements, see the repository
[contributing guide](https://github.com/webdriverio/cddl/blob/main/CONTRIBUTING.md).
