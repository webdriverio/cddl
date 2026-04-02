const GENERATED_BY_CDDL2PY_HEADER = /(# compiled with https:\/\/www\.npmjs\.com\/package\/cddl2py) v[^\n]+/g

export function normalizeSnapshotOutput (output: string): string {
    return output.replace(GENERATED_BY_CDDL2PY_HEADER, '$1')
}

export function normalizeConsoleLogCalls (calls: unknown[][]): unknown[][] {
    return calls.map((args) => args.map((arg) => typeof arg === 'string'
        ? normalizeSnapshotOutput(arg)
        : arg
    ))
}
