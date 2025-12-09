import { Params } from './instructions';
import type { RouteNode } from './route-tree';
export type UnwrapPromise<T> = T extends Promise<infer R> ? R : T;
export declare function mergeDistinct(prev: RouteNode[], next: RouteNode[]): RouteNode[];
export declare function tryStringify(value: unknown): string;
export declare function ensureArrayOfStrings(value: string | string[]): string[];
export declare function ensureString(value: string | string[]): string;
export declare function mergeURLSearchParams(source: URLSearchParams, other: Params | null, clone: boolean): URLSearchParams;
//# sourceMappingURL=util.d.ts.map