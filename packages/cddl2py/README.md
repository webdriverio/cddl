# CDDL to Python

> Generate Python type definitions from CDDL as `TypedDict` classes or Pydantic models.

`cddl2py` converts a parsed CDDL schema into Python source code. By default it emits
`TypedDict`-based definitions that work well for static typing. With the `--pydantic`
flag, it emits `BaseModel` classes instead.

## Install

Use the CLI:

```sh
npm install cddl2py
```

Use the programmatic API:

```sh
npm install cddl cddl2py
```

## What It Generates

`cddl2py` currently maps common CDDL constructs into Python-friendly types, including:

- named CDDL assignments to Python aliases or classes
- groups to `TypedDict` classes
- optional group fields to `NotRequired[...]`
- arrays to `list[...]`
- unions to `Union[...]`
- literals to `Literal[...]`
- an optional Pydantic mode that emits `BaseModel` classes and `Field(default=...)`

It also normalizes names for Python code by turning type names into `PascalCase` and
field names into `snake_case`.

## CLI

The CLI reads a CDDL file and writes generated Python code to stdout, so the normal
workflow is to redirect the output into a `.py` file.

Generate `TypedDict` output:

```sh
npx cddl2py ./path/to/schema.cddl > ./types.py
```

Generate Pydantic models:

```sh
npx cddl2py --pydantic ./path/to/schema.cddl > ./models.py
```

Show help:

```sh
npx cddl2py --help
```

## Programmatic API

The package exports a single `transform()` function. It accepts the parsed CDDL AST
and returns the generated Python source as a string.

```js
import { parse } from 'cddl'
import { transform } from 'cddl2py'

const ast = parse('./schema.cddl')
const python = transform(ast)

console.log(python)
```

To generate Pydantic models instead:

```js
import { parse } from 'cddl'
import { transform } from 'cddl2py'

const ast = parse('./schema.cddl')
const python = transform(ast, { pydantic: true })

console.log(python)
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

Generated Python (`transform(ast)`):

```python
from __future__ import annotations

from typing_extensions import NotRequired, TypedDict

class Person(TypedDict):
    name: str
    age: int
    nickname: NotRequired[str]
```

Generated Python (`transform(ast, { pydantic: true })`):

```python
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel

class Person(BaseModel):
    name: str
    age: int
    nickname: Optional[str] = None
```

## Notes

- Generated files include a header comment with the `cddl2py` version used.
- Pydantic output imports from `pydantic`, so your Python environment should have it installed if you use `--pydantic`.
- The CLI validates that the input file exists before attempting to parse it.

---

If you want to contribute fixes or improvements, see the repository
[contributing guide](https://github.com/webdriverio/cddl/blob/main/CONTRIBUTING.md).
