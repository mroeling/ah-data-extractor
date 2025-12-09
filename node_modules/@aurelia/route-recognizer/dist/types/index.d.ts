export interface IConfigurableRoute<T> {
    readonly path: string;
    readonly caseSensitive?: boolean;
    readonly handler: T;
}
export declare class Parameter {
    readonly name: string;
    readonly isOptional: boolean;
    readonly isStar: boolean;
    readonly pattern: RegExp | null;
    constructor(name: string, isOptional: boolean, isStar: boolean, pattern: RegExp | null);
    satisfiesPattern(value: string): boolean;
}
export declare class ConfigurableRoute<T> implements IConfigurableRoute<T> {
    readonly path: string;
    readonly caseSensitive: boolean;
    handler: T;
    constructor(path: string, caseSensitive: boolean, handler: T);
}
export declare class Endpoint<T> {
    readonly route: ConfigurableRoute<T>;
    readonly params: readonly Parameter[];
    private _residualEndpoint;
    get residualEndpoint(): Endpoint<T> | null;
    constructor(route: ConfigurableRoute<T>, params: readonly Parameter[]);
    equalsOrResidual(other: Endpoint<T> | null | undefined): boolean;
}
export declare class RecognizedRoute<T> {
    readonly endpoint: Endpoint<T>;
    readonly params: Readonly<Record<string, string | undefined>>;
    constructor(endpoint: Endpoint<T>, params: Readonly<Record<string, string | undefined>>);
}
/**
 * Reserved parameter name that's used when registering a route with residual star segment (catch-all).
 */
export declare const RESIDUE: "$$residue";
export declare class RouteRecognizer<T> {
    private readonly rootState;
    private readonly cache;
    private readonly endpointLookup;
    add(routeOrRoutes: IConfigurableRoute<T> | readonly IConfigurableRoute<T>[], addResidue?: boolean): void;
    private $add;
    recognize(path: string): RecognizedRoute<T> | null;
    private $recognize;
    getEndpoint(path: string): Endpoint<T> | null;
}
//# sourceMappingURL=index.d.ts.map