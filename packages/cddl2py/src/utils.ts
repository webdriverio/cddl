/**
 * Convert a string to snake_case
 * @param name - The string to convert
 * @returns The snake_case string
 */
export function snakeCase(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
        .replace(/[-.\s]+/g, '_')
        .toLowerCase()
}
