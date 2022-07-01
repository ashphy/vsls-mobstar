export function filterNonNullOrUndefined<T>(list: (T | null | undefined)[]): T[] {
    return list.flatMap((item) => (item === null || item === undefined) ? [] : [item]);
}