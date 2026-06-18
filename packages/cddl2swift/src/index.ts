import {
    isCDDLArray, isGroup, isNamedGroupReference, isLiteralWithValue,
    isNativeTypeWithOperator, isUnNamedProperty, isPropertyReference,
    isRange, isVariable, pascalCase,
    type Assignment, type PropertyType, type PropertyReference,
    type Property, type Array as CDDLArray, type Group,
    type Variable, type Comment, type Tag
} from 'cddl'

import { fieldName, enumCaseName, indent } from './utils.js'
import { pkg, NATIVE_TYPE_MAP, NULL_TYPE, ANY_TYPE } from './constants.js'

interface Context {
    assignmentsByName: Map<string, Assignment>
}

const STRING_RECORD_KEY_TYPES = new Set(['str', 'text', 'tstr'])
const RECORD_KEY_TYPES = new Set([
    'int', 'uint', 'nint', 'number', 'float', 'float16', 'float32', 'float64',
    'str', 'text', 'tstr'
])

export function transform (assignments: Assignment[]): string {
    const ctx: Context = {
        assignmentsByName: new Map(assignments.map((assignment) => [pascalCase(assignment.Name), assignment] as const)),
    }

    const blocks: string[] = []
    for (const assignment of assignments) {
        const block = generateAssignment(assignment, ctx)
        if (block) {
            blocks.push(block)
        }
    }

    const lines = [
        `// compiled with https://www.npmjs.com/package/cddl2swift v${pkg.version}`,
        '',
        blocks.join('\n\n'),
        '',
    ]

    return lines.join('\n')
}

function generateAssignment (assignment: Assignment, ctx: Context): string | null {
    if (isVariable(assignment)) {
        return generateVariable(assignment, ctx)
    }
    if (isGroup(assignment)) {
        return generateGroup(assignment as Group, ctx)
    }
    if (isCDDLArray(assignment)) {
        return generateArrayAssignment(assignment as CDDLArray, ctx)
    }
    return null
}

// ---------------------------------------------------------------------------
// Variable
// ---------------------------------------------------------------------------

function generateVariable (v: Variable, ctx: Context): string {
    const name = pascalCase(v.Name)
    const propTypes = Array.isArray(v.PropertyType) ? v.PropertyType : [v.PropertyType]
    const comments = formatLeadingComments(v.Comments)

    if (propTypes.length === 1 && isRange(propTypes[0])) {
        return `${comments}public typealias ${name} = Int`
    }

    if (propTypes.length === 1) {
        const resolved = resolveType(propTypes[0], ctx)
        const typeStr = resolved === NULL_TYPE ? optionalize(resolved) : resolved
        return `${comments}public typealias ${name} = ${typeStr}`
    }

    return comments + generateUnion(name, propTypes, ctx)
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

function generateGroup (group: Group, ctx: Context): string {
    const name = pascalCase(group.Name)
    const properties = group.Properties
    const hasChoices = properties.some((p) => Array.isArray(p))
    const comments = formatLeadingComments(group.Comments)

    if (hasChoices) {
        return comments + generateGroupChoiceUnion(name, properties, ctx)
    }

    const props = properties as Property[]

    /**
     * groups that only describe a record, e.g. `Extensible = (*text => any)`
     */
    if (props.length === 1 && RECORD_KEY_TYPES.has(props[0].Name)) {
        const propType = Array.isArray(props[0].Type) ? props[0].Type[0] : props[0].Type
        const valueType = resolveType(propType, ctx)
        return `${comments}public typealias ${name} = [String: ${optionalize(valueType)}]`
    }

    const ownProps = props.filter((p) => !isUnNamedProperty(p) && !isExtensibleRecordProperty(p))
    const inheritedProps = collectMixinProperties(props, ctx)
    const allProps = dedupeProperties([...inheritedProps, ...ownProps])

    return comments + generateStruct(name, allProps, ctx)
}

function generateGroupChoiceUnion (name: string, properties: (Property | Property[])[], ctx: Context): string {
    const variantTypes: string[] = []

    for (let i = 0; i < properties.length; i++) {
        const prop = properties[i]

        if (Array.isArray(prop)) {
            const choiceOptions = [...prop]
            const nextProp = properties[i + 1]
            if (nextProp && !Array.isArray(nextProp)) {
                choiceOptions.push(nextProp)
                i++
            }

            for (const option of choiceOptions) {
                const typeVal = Array.isArray(option.Type) ? option.Type[0] : option.Type
                if (isNamedGroupReference(typeVal)) {
                    variantTypes.push(pascalCase(typeVal.Value as string))
                } else {
                    variantTypes.push(resolveType(typeVal, ctx))
                }
            }
        } else if (isUnNamedProperty(prop)) {
            const typeVal = Array.isArray(prop.Type) ? prop.Type[0] : prop.Type
            if (isNamedGroupReference(typeVal)) {
                variantTypes.push(pascalCase(typeVal.Value as string))
            } else {
                variantTypes.push(resolveType(typeVal, ctx))
            }
        }
    }

    return generateEnumWithAssociatedValues(name, variantTypes)
}

// ---------------------------------------------------------------------------
// Unions
// ---------------------------------------------------------------------------

function generateUnion (name: string, propTypes: PropertyType[], ctx: Context): string {
    /**
     * string literal unions become a raw value backed enum, e.g.
     * `ErrorCode = "invalid argument" / "no such alert"`
     */
    const literalValues = propTypes
        .map((t) => (isLiteralWithValue(t) && typeof t.Value === 'string' ? (t.Value as string) : null))
    if (literalValues.every((v) => v !== null)) {
        return generateStringEnum(name, literalValues as string[])
    }

    const variantTypes = propTypes.map((t) => resolveType(t, ctx))
    return generateEnumWithAssociatedValues(name, variantTypes)
}

function generateStringEnum (name: string, values: string[]): string {
    const lines = [`public enum ${name}: String, Codable {`]
    const usedCaseNames = new Set<string>()
    for (const value of values) {
        const caseName = uniqueCaseName(enumCaseName(value), usedCaseNames)
        lines.push(indent(`case ${caseName} = "${value}"`))
    }
    lines.push('}')
    return lines.join('\n')
}

function generateEnumWithAssociatedValues (name: string, variantTypes: string[]): string {
    const lines = [`public enum ${name} {`]
    const usedCaseNames = new Set<string>()
    for (const variant of variantTypes) {
        if (variant === NULL_TYPE) {
            const caseName = uniqueCaseName('none', usedCaseNames)
            lines.push(indent(`case ${caseName}`))
            continue
        }
        const baseName = caseNameForType(variant)
        const caseName = uniqueCaseName(baseName, usedCaseNames)
        lines.push(indent(`case ${caseName}(${variant})`))
    }
    lines.push('}')
    return lines.join('\n')
}

function caseNameForType (type: string): string {
    const stripped = type.replace(/[\[\]?:., ]/g, ' ').trim()
    return enumCaseName(stripped || 'value')
}

function uniqueCaseName (base: string, used: Set<string>): string {
    let candidate = base
    let counter = 1
    while (used.has(candidate)) {
        candidate = `${base}${counter++}`
    }
    used.add(candidate)
    return candidate
}

// ---------------------------------------------------------------------------
// Array
// ---------------------------------------------------------------------------

function generateArrayAssignment (arr: CDDLArray, ctx: Context): string {
    const name = pascalCase(arr.Name)
    const comments = formatLeadingComments(arr.Comments)
    const elementType = resolveArrayElementType(arr, ctx)
    return `${comments}public typealias ${name} = [${elementType}]`
}

function resolveArrayElementType (arr: CDDLArray, ctx: Context): string {
    const values = arr.Values
    if (values.length === 0) {
        return ANY_TYPE
    }

    const firstVal = values[0]
    if (Array.isArray(firstVal)) {
        const options = firstVal.map((p) => {
            const t = Array.isArray(p.Type) ? p.Type[0] : p.Type
            return resolveType(t, ctx)
        })
        return combineTypes(options)
    }

    const firstType = firstVal.Type
    const types = Array.isArray(firstType) ? firstType : [firstType]

    if (types.length === 1 && isCDDLArray(types[0])) {
        const innerArr = types[0] as CDDLArray
        const innerVal = innerArr.Values[0] as Property
        const innerTypes = Array.isArray(innerVal.Type) ? innerVal.Type : [innerVal.Type]
        return `[${combineTypes(innerTypes.map((v) => resolveType(v, ctx)))}]`
    }

    return combineTypes(types.map((t) => resolveType(t, ctx)))
}

// ---------------------------------------------------------------------------
// Struct generation
// ---------------------------------------------------------------------------

function generateStruct (name: string, props: Property[], ctx: Context): string {
    const lines = [`public struct ${name} {`]

    for (const prop of props) {
        const field = generateField(prop, ctx)
        if (field) {
            lines.push(indent(field))
        }
    }

    lines.push('}')
    return lines.join('\n')
}

function generateField (prop: Property, ctx: Context): string | null {
    if (isUnNamedProperty(prop)) {
        return null
    }

    const name = fieldName(prop.Name)
    const cddlTypes: PropertyType[] = Array.isArray(prop.Type) ? prop.Type : [prop.Type]
    const resolved = cddlTypes.map((t) => resolveType(t, ctx))

    const typeStr = combineTypes(resolved)
    const isOptional = prop.Occurrence.n === 0
    const fieldType = isOptional ? optionalize(typeStr) : typeStr

    const inlineComment = prop.Comments
        .filter((c): c is Comment => Boolean(c) && !c.Leading)
        .map((c) => c.Content.trim())
        .join('; ')
    const commentSuffix = inlineComment ? ` // ${inlineComment}` : ''

    return `public var ${name}: ${fieldType}${commentSuffix}`
}

// ---------------------------------------------------------------------------
// Mixins
// ---------------------------------------------------------------------------

function collectMixinProperties (props: Property[], ctx: Context, seen = new Set<string>()): Property[] {
    const collected: Property[] = []

    for (const prop of props) {
        if (!isUnNamedProperty(prop)) {
            continue
        }

        const types = Array.isArray(prop.Type) ? prop.Type : [prop.Type]
        for (const type of types) {
            const referenced = referencedGroupName(type)
            if (!referenced || seen.has(referenced)) {
                continue
            }
            seen.add(referenced)
            const assignment = ctx.assignmentsByName.get(referenced)
            if (assignment && isGroup(assignment) && !assignment.Properties.some((p) => Array.isArray(p))) {
                const groupProps = assignment.Properties as Property[]
                collected.push(...collectMixinProperties(groupProps, ctx, seen))
                collected.push(...groupProps.filter((p) => !isUnNamedProperty(p) && !isExtensibleRecordProperty(p)))
            }
        }
    }

    return collected
}

function referencedGroupName (type: PropertyType): string | undefined {
    if (isNamedGroupReference(type)) {
        return pascalCase((type as unknown as PropertyReference).Value as string)
    }
    if (isNativeTypeWithOperator(type) && isNamedGroupReference(type.Type)) {
        return pascalCase((type.Type as unknown as PropertyReference).Value as string)
    }
    return undefined
}

function dedupeProperties (props: Property[]): Property[] {
    const seen = new Set<string>()
    const result: Property[] = []
    for (const prop of props) {
        if (seen.has(prop.Name)) {
            continue
        }
        seen.add(prop.Name)
        result.push(prop)
    }
    return result
}

function isExtensibleRecordProperty (prop: Property): boolean {
    return !isUnNamedProperty(prop) &&
        prop.Occurrence.m === Infinity &&
        !prop.HasCut &&
        STRING_RECORD_KEY_TYPES.has(prop.Name)
}

// ---------------------------------------------------------------------------
// Type resolution
// ---------------------------------------------------------------------------

function resolveType (t: PropertyType, ctx: Context): string {
    if (typeof t === 'string') {
        if (t === 'null' || t === 'nil') {
            return NULL_TYPE
        }
        const mapped = NATIVE_TYPE_MAP[t]
        if (mapped) {
            return mapped
        }
        throw new Error(`Unknown native type: "${t}"`)
    }

    if (isNativeTypeWithOperator(t) && typeof t.Type === 'string') {
        const mapped = NATIVE_TYPE_MAP[t.Type]
        if (mapped) {
            return mapped
        }
        throw new Error(`Unknown native type with operator: ${JSON.stringify(t)}`)
    }

    if (isPropertyReference(t) && (t as PropertyReference).Value === 'null') {
        return NULL_TYPE
    }

    if (isGroup(t)) {
        if (isNamedGroupReference(t)) {
            return pascalCase((t as unknown as PropertyReference).Value as string)
        }

        const group = t as unknown as Group
        if (group.Properties) {
            const props = group.Properties

            if (props.some((p) => Array.isArray(p))) {
                return ANY_TYPE
            }

            if ((props as Property[]).every(isUnNamedProperty)) {
                const items = (props as Property[]).map((p) => {
                    const subType = Array.isArray(p.Type) ? p.Type[0] : p.Type
                    return resolveType(subType as PropertyType, ctx)
                })
                if (items.length === 1) {
                    return items[0]
                }
                return `(${items.join(', ')})`
            }

            if (props.length === 1 && RECORD_KEY_TYPES.has((props[0] as Property).Name)) {
                const valType = resolveType(((props[0] as Property).Type as PropertyType[])[0], ctx)
                return `[String: ${optionalize(valType)}]`
            }

            return `[String: ${ANY_TYPE}]`
        }

        throw new Error(`Unknown group type: ${JSON.stringify(t)}`)
    }

    if (isLiteralWithValue(t)) {
        if (typeof t.Value === 'string') {
            return 'String'
        }
        if (typeof t.Value === 'number') {
            return Number.isInteger(t.Value) ? 'Int' : 'Double'
        }
        if (typeof t.Value === 'boolean') {
            return 'Bool'
        }
        if (typeof t.Value === 'bigint') {
            return 'Int'
        }
        if (t.Value === null) {
            return NULL_TYPE
        }
        throw new Error(`Unsupported literal: ${JSON.stringify(t)}`)
    }

    if (isCDDLArray(t)) {
        return `[${resolveArrayElementType(t as unknown as CDDLArray, ctx)}]`
    }

    if (isRange(t)) {
        return 'Int'
    }

    if (isPropertyReference(t) && (t as PropertyReference).Type === 'range') {
        return 'Int'
    }

    if (isNativeTypeWithOperator(t) && isNamedGroupReference(t.Type)) {
        return pascalCase((t.Type as unknown as PropertyReference).Value as string)
    }

    if (isPropertyReference(t)) {
        const ref = t as PropertyReference
        if (ref.Type === 'group_array' && typeof ref.Value === 'string') {
            return `[${pascalCase(ref.Value)}]`
        }
        if (ref.Type === 'tag') {
            const tag = ref.Value as Tag
            const mapped = NATIVE_TYPE_MAP[tag.TypePart]
            return mapped ?? pascalCase(tag.TypePart)
        }
    }

    throw new Error(`Unknown type: ${JSON.stringify(t)}`)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collapse a list of resolved CDDL types into a single Swift type. Swift has no
 * structural union/intersection types, so anything that does not reduce to a
 * single concrete type (optionally nullable) falls back to `Any`.
 */
function combineTypes (resolved: string[]): string {
    const hasNull = resolved.includes(NULL_TYPE)
    const concrete = [...new Set(resolved.filter((t) => t !== NULL_TYPE))]

    if (concrete.length === 0) {
        return hasNull ? `${ANY_TYPE}?` : ANY_TYPE
    }
    if (concrete.length === 1) {
        return hasNull ? optionalize(concrete[0]) : concrete[0]
    }
    return ANY_TYPE
}

function optionalize (type: string): string {
    if (type === NULL_TYPE) {
        return `${ANY_TYPE}?`
    }
    return type.endsWith('?') ? type : `${type}?`
}

function formatLeadingComments (comments: Array<Comment | null | undefined> = []): string {
    const leading = comments.filter((c): c is Comment => c !== null && c !== undefined && c.Leading)
    if (leading.length === 0) {
        return ''
    }
    return leading.map((c) => `// ${c.Content}`).join('\n') + '\n'
}
