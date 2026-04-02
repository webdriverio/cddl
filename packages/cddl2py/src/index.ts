import {
    isCDDLArray, isGroup, isNamedGroupReference, isLiteralWithValue,
    isNativeTypeWithOperator, isUnNamedProperty, isPropertyReference,
    isRange, isVariable, pascalCase,
    type Assignment, type PropertyType, type PropertyReference,
    type Property, type Array as CDDLArray, type Operator, type Group,
    type Variable, type Comment, type Tag
} from 'cddl'

import { snakeCase } from './utils.js'
import { pkg, NATIVE_TYPE_MAP } from './constants.js'

export interface TransformOptions {
    pydantic?: boolean
}

interface Context {
    pydantic: boolean
    typingImports: Set<string>
    typingExtensionsImports: Set<string>
    pydanticImports: Set<string>
    definedTypeNames: Set<string>
    assignmentsByName: Map<string, Assignment>
    aliasUnionTypesByName: Map<string, string[]>
}

interface ResolveTypeOptions {
    quoteForwardReferences?: boolean
}

export function transform (assignments: Assignment[], options?: TransformOptions): string {
    const ctx: Context = {
        pydantic: options?.pydantic ?? false,
        typingImports: new Set(),
        typingExtensionsImports: new Set(),
        pydanticImports: new Set(),
        definedTypeNames: new Set(),
        assignmentsByName: new Map(assignments.map((assignment) => [pascalCase(assignment.Name), assignment] as const)),
        aliasUnionTypesByName: new Map(),
    }

    const blocks: string[] = []
    const orderedAssignments = orderAssignments(assignments)

    for (const assignment of orderedAssignments) {
        const block = generateAssignment(assignment, ctx)
        if (block) {
            blocks.push(block)
        }
        ctx.definedTypeNames.add(pascalCase(assignment.Name))
    }

    return renderOutput(ctx, blocks)
}

function renderOutput (ctx: Context, blocks: string[]): string {
    const lines: string[] = []

    lines.push(`# compiled with https://www.npmjs.com/package/cddl2py v${pkg.version}`)
    lines.push('')
    lines.push('from __future__ import annotations')
    lines.push('')

    if (ctx.typingImports.size > 0) {
        lines.push(`from typing import ${[...ctx.typingImports].sort().join(', ')}`)
    }

    if (ctx.pydantic) {
        if (ctx.pydanticImports.size > 0) {
            lines.push(`from pydantic import ${[...ctx.pydanticImports].sort().join(', ')}`)
        }
    } else if (ctx.typingExtensionsImports.size > 0) {
        lines.push(`from typing_extensions import ${[...ctx.typingExtensionsImports].sort().join(', ')}`)
    }

    if (ctx.typingImports.size > 0 || ctx.pydanticImports.size > 0 || ctx.typingExtensionsImports.size > 0) {
        lines.push('')
    }

    lines.push(blocks.join('\n\n'))
    lines.push('')

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
        return `${comments}${name} = int`
    }

    const types = propTypes.map(t => resolveType(t, ctx, { quoteForwardReferences: true }))

    if (types.length === 1) {
        return `${comments}${name} = ${types[0]}`
    }

    ctx.typingImports.add('Union')
    ctx.aliasUnionTypesByName.set(name, types)
    return `${comments}${name} = Union[${types.join(', ')}]`
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

function generateGroup (group: Group, ctx: Context): string {
    const name = pascalCase(group.Name)
    const properties = group.Properties
    const hasChoices = properties.some(p => Array.isArray(p))
    const comments = formatLeadingComments(group.Comments)

    if (hasChoices) {
        return comments + generateGroupWithChoices(name, properties, ctx)
    }

    const props = properties as Property[]

    if (props.length === 1) {
        const prop = props[0]
        const propType = Array.isArray(prop.Type) ? prop.Type : [prop.Type]
        if (propType.length === 1 && Object.keys(NATIVE_TYPE_MAP).includes(prop.Name)) {
            const keyType = NATIVE_TYPE_MAP[prop.Name]
            if (keyType === 'Any') {
                ctx.typingImports.add('Any')
            }
            const valType = resolveType(propType[0], ctx)
            return `${comments}${name} = dict[${keyType}, ${valType}]`
        }
    }

    const mixins = props.filter(isUnNamedProperty)
    const ownProps = props.filter(p => !isUnNamedProperty(p))

    const simpleMixinBases: string[] = []
    const unionMixinGroups: string[][] = []

    for (const mixin of mixins) {
        if (Array.isArray(mixin.Type) && mixin.Type.length > 1) {
            const unionTypes = mixin.Type.map(t => resolveType(t, ctx))
            unionMixinGroups.push(unionTypes)
        } else {
            const typeVal = Array.isArray(mixin.Type) ? mixin.Type[0] : mixin.Type
            const mixinTarget = resolveMixinTarget(typeVal, ctx)
            if (mixinTarget) {
                if (mixinTarget.kind === 'union') {
                    unionMixinGroups.push(mixinTarget.types)
                } else {
                    simpleMixinBases.push(mixinTarget.type)
                }
            } else if (isGroup(typeVal) && !isNamedGroupReference(typeVal) && (typeVal as Group).Properties) {
                const inlineGroup = typeVal as Group
                const inlineProps = inlineGroup.Properties as Property[]
                const inlineMixinBases: string[] = []
                for (const p of inlineProps) {
                    if (isUnNamedProperty(p)) {
                        const innerType = Array.isArray(p.Type) ? p.Type[0] : p.Type
                        if (isNamedGroupReference(innerType)) {
                            inlineMixinBases.push(pascalCase(innerType.Value))
                        }
                    }
                }
                simpleMixinBases.push(...inlineMixinBases)
            }
        }
    }

    if (unionMixinGroups.length > 0) {
        return comments + generateGroupWithUnionMixins(name, simpleMixinBases, unionMixinGroups, ownProps, ctx)
    }

    return comments + generateClass(name, simpleMixinBases, ownProps, ctx)
}

function generateGroupWithChoices (name: string, properties: (Property | Property[])[], ctx: Context): string {
    const blocks: string[] = []
    const unionTypes: string[] = []
    let variantIndex = 0

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

                if (isUnNamedProperty(option)) {
                    if (isNamedGroupReference(typeVal)) {
                        unionTypes.push(pascalCase(typeVal.Value as string))
                    } else {
                        unionTypes.push(resolveType(typeVal, ctx))
                    }
                } else {
                    const variantName = `_${name}Variant${variantIndex}`
                    variantIndex++
                    blocks.push(generateClass(variantName, [], [option], ctx))
                    unionTypes.push(variantName)
                }
            }
        } else if (isUnNamedProperty(prop)) {
            const typeVal = Array.isArray(prop.Type) ? prop.Type[0] : prop.Type
            if (isNamedGroupReference(typeVal)) {
                unionTypes.push(pascalCase(typeVal.Value as string))
            } else if (Array.isArray(prop.Type) && prop.Type.length > 1) {
                for (const t of prop.Type) {
                    unionTypes.push(resolveType(t, ctx))
                }
            } else {
                unionTypes.push(resolveType(typeVal, ctx))
            }
        } else {
            const variantName = `_${name}Variant${variantIndex}`
            variantIndex++
            blocks.push(generateClass(variantName, [], [prop], ctx))
            unionTypes.push(variantName)
        }
    }

    if (unionTypes.length === 1) {
        blocks.push(`${name} = ${unionTypes[0]}`)
    } else {
        ctx.typingImports.add('Union')
        ctx.aliasUnionTypesByName.set(name, unionTypes)
        blocks.push(`${name} = Union[${unionTypes.join(', ')}]`)
    }

    return blocks.join('\n\n')
}

function generateGroupWithUnionMixins (
    name: string,
    simpleBases: string[],
    unionGroups: string[][],
    ownProps: Property[],
    ctx: Context
): string {
    if (ownProps.length === 0 && simpleBases.length === 0) {
        const allTypes = unionGroups.flat()
        if (allTypes.length === 1) {
            return `${name} = ${allTypes[0]}`
        }
        ctx.typingImports.add('Union')
        return `${name} = Union[${allTypes.join(', ')}]`
    }

    const blocks: string[] = []
    const variantNames: string[] = []

    if (unionGroups.length === 1) {
        const unionTypes = unionGroups[0]

        if (ownProps.length > 0) {
            const baseName = `_${name}Fields`
            blocks.push(generateClass(baseName, [], ownProps, ctx))

            for (let i = 0; i < unionTypes.length; i++) {
                const variantName = `_${name}Variant${i}`
                variantNames.push(variantName)
                const bases = [baseName, unionTypes[i], ...simpleBases]
                blocks.push(generateClass(variantName, bases, [], ctx))
            }
        } else {
            for (let i = 0; i < unionTypes.length; i++) {
                const variantName = `_${name}Variant${i}`
                variantNames.push(variantName)
                const bases = [unionTypes[i], ...simpleBases]
                blocks.push(generateClass(variantName, bases, [], ctx))
            }
        }
    } else {
        const allTypes = [...simpleBases, ...unionGroups.flat()]
        ctx.typingImports.add('Union')
        blocks.push(`${name} = Union[${allTypes.join(', ')}]`)
        return blocks.join('\n\n')
    }

    ctx.typingImports.add('Union')
    ctx.aliasUnionTypesByName.set(name, variantNames)
    blocks.push(`${name} = Union[${variantNames.join(', ')}]`)

    return blocks.join('\n\n')
}

// ---------------------------------------------------------------------------
// Array
// ---------------------------------------------------------------------------

function generateArrayAssignment (arr: CDDLArray, ctx: Context): string {
    const name = pascalCase(arr.Name)
    const comments = formatLeadingComments(arr.Comments)

    const values = arr.Values
    if (values.length === 0) {
        ctx.typingImports.add('Any')
        return `${comments}${name} = list[Any]`
    }

    const firstVal = values[0]

    if (Array.isArray(firstVal)) {
        const options = firstVal.map(p => {
            const t = Array.isArray(p.Type) ? p.Type[0] : p.Type
            return resolveType(t, ctx, { quoteForwardReferences: true })
        })
        if (options.length === 1) {
            return `${comments}${name} = list[${options[0]}]`
        }
        ctx.typingImports.add('Union')
        return `${comments}${name} = list[Union[${options.join(', ')}]]`
    }

    const firstType = firstVal.Type
    const types = Array.isArray(firstType) ? firstType : [firstType]

    if (types.length === 1 && isCDDLArray(types[0])) {
        const innerArr = types[0] as CDDLArray
        const innerVal = innerArr.Values[0] as Property
        const innerTypes = Array.isArray(innerVal.Type) ? innerVal.Type : [innerVal.Type]
        const typeStrs = innerTypes.map(v => resolveType(v, ctx, { quoteForwardReferences: true }))

        if (typeStrs.length === 1) {
            return `${comments}${name} = list[${typeStrs[0]}]`
        }
        ctx.typingImports.add('Union')
        return `${comments}${name} = list[Union[${typeStrs.join(', ')}]]`
    }

    const typeStrs = types.map(t => resolveType(t, ctx, { quoteForwardReferences: true }))

    if (typeStrs.length === 1) {
        return `${comments}${name} = list[${typeStrs[0]}]`
    }

    ctx.typingImports.add('Union')
    return `${comments}${name} = list[Union[${typeStrs.join(', ')}]]`
}

// ---------------------------------------------------------------------------
// Class generation (TypedDict or Pydantic BaseModel)
// ---------------------------------------------------------------------------

function generateClass (name: string, bases: string[], props: Property[], ctx: Context): string {
    const lines: string[] = []

    let classDecl: string
    if (ctx.pydantic) {
        ctx.pydanticImports.add('BaseModel')
        const pydanticBases = bases.filter((base) => isModelCompatibleBase(base, ctx))
        if (pydanticBases.length > 0) {
            classDecl = `class ${name}(${pydanticBases.join(', ')}):`
        } else {
            classDecl = `class ${name}(BaseModel):`
        }
    } else {
        ctx.typingExtensionsImports.add('TypedDict')
        const typedDictBases = bases.filter((base) => isModelCompatibleBase(base, ctx))
        if (typedDictBases.length > 0) {
            classDecl = `class ${name}(${typedDictBases.join(', ')}):`
        } else {
            classDecl = `class ${name}(TypedDict):`
        }
    }

    lines.push(classDecl)

    if (props.length === 0) {
        lines.push('    pass')
        return lines.join('\n')
    }

    for (const prop of props) {
        const fieldLine = generateField(prop, ctx)
        if (fieldLine) {
            lines.push(fieldLine)
        }
    }

    if (lines.length === 1) {
        lines.push('    pass')
    }

    return lines.join('\n')
}

function generateField (prop: Property, ctx: Context): string | null {
    if (isUnNamedProperty(prop)) {
        return null
    }

    const propName = snakeCase(prop.Name)
    const cddlTypes: PropertyType[] = Array.isArray(prop.Type) ? prop.Type : [prop.Type]
    const isOptional = prop.Occurrence.n === 0

    let typeStr: string
    const types = cddlTypes.map(t => resolveType(t, ctx))

    if (types.length === 1) {
        typeStr = types[0]
    } else {
        ctx.typingImports.add('Union')
        typeStr = `Union[${types.join(', ')}]`
    }

    const inlineComment = prop.Comments
        .filter((c): c is Comment => Boolean(c) && !c.Leading)
        .map(c => c.Content.trim())
        .join('; ')
    const commentSuffix = inlineComment ? `  # ${inlineComment}` : ''

    let defaultExpr = ''
    if (prop.Operator && prop.Operator.Type === 'default') {
        defaultExpr = formatDefaultValue(prop.Operator)
    }
    for (const t of cddlTypes) {
        if (isPropertyReference(t) && (t as PropertyReference).Operator?.Type === 'default') {
            const val = formatDefaultValue((t as PropertyReference).Operator!)
            if (val) {
                defaultExpr = val
            }
        }
    }

    if (ctx.pydantic) {
        if (isOptional) {
            ctx.typingImports.add('Optional')
            if (defaultExpr) {
                ctx.pydanticImports.add('Field')
                return `    ${propName}: Optional[${typeStr}] = Field(default=${defaultExpr})${commentSuffix}`
            }
            return `    ${propName}: Optional[${typeStr}] = None${commentSuffix}`
        }
        if (defaultExpr) {
            ctx.pydanticImports.add('Field')
            return `    ${propName}: ${typeStr} = Field(default=${defaultExpr})${commentSuffix}`
        }
        return `    ${propName}: ${typeStr}${commentSuffix}`
    }

    if (isOptional) {
        ctx.typingExtensionsImports.add('NotRequired')
        return `    ${propName}: NotRequired[${typeStr}]${commentSuffix}`
    }
    return `    ${propName}: ${typeStr}${commentSuffix}`
}

// ---------------------------------------------------------------------------
// Type resolution
// ---------------------------------------------------------------------------

function resolveType (t: PropertyType, ctx: Context, options: ResolveTypeOptions = {}): string {
    if (typeof t === 'string') {
        const mapped = NATIVE_TYPE_MAP[t]
        if (mapped) {
            if (mapped === 'Any') {
                ctx.typingImports.add('Any')
            }
            return mapped
        }
        throw new Error(`Unknown native type: "${t}"`)
    }

    if ((t as any).Type && typeof (t as any).Type === 'string' && NATIVE_TYPE_MAP[(t as any).Type]) {
        const mapped = NATIVE_TYPE_MAP[(t as any).Type]
        if (mapped === 'Any') {
            ctx.typingImports.add('Any')
        }
        return mapped
    }

    if (isNativeTypeWithOperator(t) && NATIVE_TYPE_MAP[(t.Type as any).Type]) {
        const mapped = NATIVE_TYPE_MAP[(t.Type as any).Type]
        if (mapped === 'Any') {
            ctx.typingImports.add('Any')
        }
        return mapped
    }

    if (isPropertyReference(t) && (t as PropertyReference).Value === 'null') {
        return 'None'
    }

    if (isGroup(t)) {
        if (isNamedGroupReference(t)) {
            return formatTypeReference(pascalCase((t as unknown as PropertyReference).Value as string), ctx, options)
        }

        const group = t as unknown as Group
        if (group.Properties) {
            const props = group.Properties

            if (props.some(p => Array.isArray(p))) {
                const choiceTypes: string[] = []
                for (const choice of props) {
                    const subProps = Array.isArray(choice) ? choice : [choice]
                    if (subProps.length === 1 && isUnNamedProperty(subProps[0])) {
                        const subType = Array.isArray(subProps[0].Type) ? subProps[0].Type[0] : subProps[0].Type
                        choiceTypes.push(resolveType(subType as PropertyType, ctx, options))
                        continue
                    }
                    if (subProps.every(isUnNamedProperty)) {
                        const tupleItems = subProps.map(p => {
                            const subType = Array.isArray(p.Type) ? p.Type[0] : p.Type
                            return resolveType(subType as PropertyType, ctx, options)
                        })
                        ctx.typingImports.add('Tuple')
                        choiceTypes.push(`Tuple[${tupleItems.join(', ')}]`)
                        continue
                    }
                }
                if (choiceTypes.length > 1) {
                    ctx.typingImports.add('Union')
                    return `Union[${choiceTypes.join(', ')}]`
                }
                if (choiceTypes.length === 1) {
                    return choiceTypes[0]
                }
            }

            if ((props as Property[]).every(isUnNamedProperty)) {
                const items = (props as Property[]).map(p => {
                    const subType = Array.isArray(p.Type) ? p.Type[0] : p.Type
                    return resolveType(subType as PropertyType, ctx, options)
                })
                if (items.length === 1) {
                    return items[0]
                }
                ctx.typingImports.add('Tuple')
                return `Tuple[${items.join(', ')}]`
            }

            if (props.length === 1 && Object.keys(NATIVE_TYPE_MAP).includes((props[0] as Property).Name)) {
                const keyType = NATIVE_TYPE_MAP[(props[0] as Property).Name]
                if (keyType === 'Any') {
                    ctx.typingImports.add('Any')
                }
                const valType = resolveType(((props[0] as Property).Type as PropertyType[])[0], ctx, options)
                return `dict[${keyType}, ${valType}]`
            }

            ctx.typingImports.add('Any')
            return 'dict[str, Any]'
        }

        throw new Error(`Unknown group type: ${JSON.stringify(t)}`)
    }

    if (isLiteralWithValue(t)) {
        ctx.typingImports.add('Literal')
        if (typeof t.Value === 'string') {
            return `Literal["${t.Value}"]`
        }
        if (typeof t.Value === 'number') {
            return `Literal[${t.Value}]`
        }
        if (typeof t.Value === 'boolean') {
            return `Literal[${t.Value ? 'True' : 'False'}]`
        }
        if (typeof t.Value === 'bigint') {
            return `Literal[${t.Value.toString()}]`
        }
        if (t.Value === null) {
            return 'None'
        }
        throw new Error(`Unsupported literal: ${JSON.stringify(t)}`)
    }

    if (isCDDLArray(t)) {
        const arrValues = (t as unknown as CDDLArray).Values
        if (arrValues.length === 0) {
            ctx.typingImports.add('Any')
            return 'list[Any]'
        }
        const firstVal = arrValues[0] as Property
        const innerTypes = Array.isArray(firstVal.Type) ? firstVal.Type : [firstVal.Type]
        const typeStrs = innerTypes.map(v => resolveType(v, ctx, options))

        if (typeStrs.length === 1) {
            return `list[${typeStrs[0]}]`
        }
        ctx.typingImports.add('Union')
        return `list[Union[${typeStrs.join(', ')}]]`
    }

    if (isRange(t)) {
        return 'int'
    }

    if (isPropertyReference(t) && (t as PropertyReference).Type === 'range') {
        return 'int'
    }

    if (isNativeTypeWithOperator(t) && isNamedGroupReference(t.Type)) {
        return formatTypeReference(pascalCase((t.Type as unknown as PropertyReference).Value as string), ctx, options)
    }

    if (isPropertyReference(t)) {
        const ref = t as PropertyReference
        if (ref.Type === 'group_array' && typeof ref.Value === 'string') {
            return `list[${formatTypeReference(pascalCase(ref.Value), ctx, options)}]`
        }
        if (ref.Type === 'tag') {
            const tag = ref.Value as Tag
            const mapped = NATIVE_TYPE_MAP[tag.TypePart]
            if (mapped) {
                if (mapped === 'Any') {
                    ctx.typingImports.add('Any')
                }
                return mapped
            }
            return formatTypeReference(pascalCase(tag.TypePart), ctx, options)
        }
    }

    throw new Error(`Unknown type: ${JSON.stringify(t)}`)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLeadingComments (comments: Array<Comment | null | undefined> = []): string {
    const leading = comments.filter((c): c is Comment => c !== null && c !== undefined && c.Leading)
    if (leading.length === 0) {
        return ''
    }
    return leading.map(c => `# ${c.Content}`).join('\n') + '\n'
}

function formatTypeReference (typeName: string, ctx: Context, options: ResolveTypeOptions): string {
    if (!options.quoteForwardReferences || ctx.definedTypeNames.has(typeName)) {
        return typeName
    }

    return `"${typeName}"`
}

function formatDefaultValue (operator: Operator): string {
    if (operator.Type !== 'default') {
        return ''
    }

    const val = operator.Value
    if (val === 'null') {
        return 'None'
    }

    const ref = val as PropertyReference
    if (ref.Type === 'literal') {
        if (typeof ref.Value === 'string') {
            return `"${ref.Value}"`
        }
        if (typeof ref.Value === 'number') {
            return String(ref.Value)
        }
        if (typeof ref.Value === 'boolean') {
            return ref.Value ? 'True' : 'False'
        }
    }

    return ''
}

function orderAssignments (assignments: Assignment[]): Assignment[] {
    const assignmentsByName = new Map(
        assignments.map((assignment) => [pascalCase(assignment.Name), assignment] as const)
    )
    const ordered: Assignment[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    function visit (assignment: Assignment) {
        const name = pascalCase(assignment.Name)
        if (visited.has(name) || visiting.has(name)) {
            return
        }

        visiting.add(name)
        for (const dependencyName of getHardDependencies(assignment, assignmentsByName)) {
            const dependency = assignmentsByName.get(dependencyName)
            if (dependency) {
                visit(dependency)
            }
        }
        visiting.delete(name)
        visited.add(name)
        ordered.push(assignment)
    }

    for (const assignment of assignments) {
        visit(assignment)
    }

    return ordered
}

function getHardDependencies (assignment: Assignment, assignmentsByName: Map<string, Assignment>): string[] {
    if (!isGroup(assignment)) {
        return []
    }

    const deps = new Set<string>()
    for (const propertyOrChoice of assignment.Properties) {
        const properties = Array.isArray(propertyOrChoice) ? propertyOrChoice : [propertyOrChoice]
        for (const property of properties) {
            if (!isUnNamedProperty(property)) {
                continue
            }

            for (const dependency of getMixinDependencies(property.Type, assignmentsByName)) {
                deps.add(dependency)
            }
        }
    }

    return [...deps]
}

function getMixinDependencies (type: Property['Type'], assignmentsByName: Map<string, Assignment>): string[] {
    const deps = new Set<string>()
    const values = Array.isArray(type) ? type : [type]

    for (const value of values) {
        if (isNamedGroupReference(value)) {
            for (const dependency of getNamedMixinDependencies(pascalCase(value.Value as string), assignmentsByName)) {
                deps.add(dependency)
            }
            continue
        }

        if (isNativeTypeWithOperator(value) && isNamedGroupReference(value.Type)) {
            for (const dependency of getNamedMixinDependencies(pascalCase(value.Type.Value as string), assignmentsByName)) {
                deps.add(dependency)
            }
            continue
        }

        if (isGroup(value) && !isNamedGroupReference(value) && value.Properties) {
            for (const property of value.Properties) {
                if (Array.isArray(property)) {
                    for (const choice of property) {
                        if (isUnNamedProperty(choice)) {
                            for (const dependency of getMixinDependencies(choice.Type, assignmentsByName)) {
                                deps.add(dependency)
                            }
                        }
                    }
                    continue
                }

                if (!isUnNamedProperty(property)) {
                    continue
                }

                for (const dependency of getMixinDependencies(property.Type, assignmentsByName)) {
                    deps.add(dependency)
                }
            }
        }
    }

    return [...deps]
}

function getNamedMixinDependencies (name: string, assignmentsByName: Map<string, Assignment>): string[] {
    const assignment = assignmentsByName.get(name)
    if (!assignment || !isVariable(assignment)) {
        return [name]
    }

    const propertyTypes = Array.isArray(assignment.PropertyType) ? assignment.PropertyType : [assignment.PropertyType]
    const deps = new Set<string>()

    for (const propertyType of propertyTypes) {
        const referencedName = getReferencedMixinName(propertyType)
        if (referencedName) {
            for (const dependency of getNamedMixinDependencies(referencedName, assignmentsByName)) {
                deps.add(dependency)
            }
            continue
        }
    }

    return deps.size > 0 ? [...deps] : [name]
}

function getReferencedMixinName (propertyType: PropertyType): string | undefined {
    if (isNamedGroupReference(propertyType)) {
        return pascalCase(propertyType.Value as string)
    }

    if (isNativeTypeWithOperator(propertyType) && isNamedGroupReference(propertyType.Type)) {
        return pascalCase(propertyType.Type.Value as string)
    }

    return undefined
}

function resolveMixinTarget (
    propertyType: PropertyType,
    ctx: Context
): { kind: 'single', type: string } | { kind: 'union', types: string[] } | null {
    const name = getReferencedMixinName(propertyType)
    if (!name) {
        return null
    }

    const unionTypes = ctx.aliasUnionTypesByName.get(name)
    if (unionTypes && unionTypes.length > 1) {
        return { kind: 'union', types: expandMixinUnionTypes(unionTypes, ctx) }
    }

    const assignment = ctx.assignmentsByName.get(name)
    if (!assignment || !isVariable(assignment)) {
        return { kind: 'single', type: name }
    }

    const propertyTypes = Array.isArray(assignment.PropertyType) ? assignment.PropertyType : [assignment.PropertyType]
    if (propertyTypes.length > 1) {
        return { kind: 'union', types: expandMixinUnionTypes(propertyTypes.map((type) => resolveType(type, ctx)), ctx) }
    }

    const referencedName = getReferencedMixinName(propertyTypes[0])
    if (referencedName) {
        return { kind: 'single', type: referencedName }
    }

    return { kind: 'single', type: name }
}

function expandMixinUnionTypes (types: string[], ctx: Context, seen = new Set<string>()): string[] {
    const expanded: string[] = []

    for (const type of types) {
        if (seen.has(type)) {
            expanded.push(type)
            continue
        }

        const nested = ctx.aliasUnionTypesByName.get(type)
        if (nested && nested.length > 1) {
            seen.add(type)
            expanded.push(...expandMixinUnionTypes(nested, ctx, seen))
            seen.delete(type)
            continue
        }

        expanded.push(type)
    }

    return [...new Set(expanded)]
}

function isModelCompatibleBase (base: string, ctx: Context, seen = new Set<string>()): boolean {
    if (base.startsWith('_')) {
        return true
    }

    if (seen.has(base)) {
        return false
    }

    const assignment = ctx.assignmentsByName.get(base)
    if (!assignment) {
        return false
    }

    if (isGroup(assignment)) {
        return isConcreteGroupBase(assignment)
    }

    if (isCDDLArray(assignment)) {
        return false
    }

    if (!isVariable(assignment)) {
        return false
    }

    const propertyTypes = Array.isArray(assignment.PropertyType) ? assignment.PropertyType : [assignment.PropertyType]
    if (propertyTypes.length !== 1) {
        return false
    }

    const referencedName = getReferencedMixinName(propertyTypes[0])
    if (!referencedName) {
        return false
    }

    seen.add(base)
    const isCompatible = isModelCompatibleBase(referencedName, ctx, seen)
    seen.delete(base)
    return isCompatible
}

function isConcreteGroupBase (group: Group): boolean {
    if (group.Properties.some((property) => Array.isArray(property))) {
        return false
    }

    const properties = group.Properties as Property[]
    if (properties.length === 1 && Object.keys(NATIVE_TYPE_MAP).includes(properties[0].Name)) {
        return false
    }

    return true
}
