class Parameter {
    constructor(t, e, s, i) {
        this.name = t;
        this.isOptional = e;
        this.isStar = s;
        this.pattern = i;
    }
    satisfiesPattern(t) {
        if (this.pattern === null) return true;
        this.pattern.lastIndex = 0;
        return this.pattern.test(t);
    }
}

class ConfigurableRoute {
    constructor(t, e, s) {
        this.path = t;
        this.caseSensitive = e;
        this.handler = s;
    }
}

class Endpoint {
    get residualEndpoint() {
        return this.t;
    }
    set residualEndpoint(t) {
        if (this.t !== null) throw new Error("Residual endpoint is already set");
        this.t = t;
    }
    constructor(t, e) {
        this.route = t;
        this.params = e;
        this.t = null;
    }
    equalsOrResidual(t) {
        return t != null && this === t || this.t === t;
    }
}

class RecognizedRoute {
    constructor(t, e) {
        this.endpoint = t;
        const s = Object.create(null);
        for (const t in e) {
            const i = e[t];
            s[t] = i != null ? decodeURIComponent(i) : i;
        }
        this.params = Object.freeze(s);
    }
}

class Candidate {
    constructor(t, e, s, i) {
        this.chars = t;
        this.states = e;
        this.skippedStates = s;
        this.result = i;
        this.params = null;
        this.isConstrained = false;
        this.satisfiesConstraints = null;
        this.head = e[e.length - 1];
        this.endpoint = this.head?.endpoint;
    }
    advance(t) {
        const {chars: e, states: s, skippedStates: i, result: n} = this;
        let r = null;
        let o = 0;
        const l = s[s.length - 1];
        function $process(a, u) {
            if (a.isMatch(t)) {
                if (++o === 1) {
                    r = a;
                } else {
                    n.add(new Candidate(e.concat(t), s.concat(a), u === null ? i : i.concat(u), n));
                }
            }
            if (l.segment === null && a.isOptional && a.nextStates !== null) {
                if (a.nextStates.length > 1) {
                    throw createError(`${a.nextStates.length} nextStates`);
                }
                const t = a.nextStates[0];
                if (!t.isSeparator) {
                    throw createError(`Not a separator`);
                }
                if (t.nextStates !== null) {
                    for (const e of t.nextStates) {
                        $process(e, a);
                    }
                }
            }
        }
        if (l.isDynamic) {
            $process(l, null);
        }
        if (l.nextStates !== null) {
            for (const t of l.nextStates) {
                $process(t, null);
            }
        }
        if (r !== null) {
            s.push(this.head = r);
            e.push(t);
            this.isConstrained = this.isConstrained || r.isDynamic && r.segment.isConstrained;
            if (r.endpoint !== null) {
                this.endpoint = r.endpoint;
            }
        }
        if (o === 0) {
            n.remove(this);
        }
    }
    i() {
        function collectSkippedStates(t, e) {
            const s = e.nextStates;
            if (s !== null) {
                if (s.length === 1 && s[0].segment === null) {
                    collectSkippedStates(t, s[0]);
                } else {
                    for (const e of s) {
                        if (e.isOptional && e.endpoint !== null) {
                            t.push(e);
                            if (e.nextStates !== null) {
                                for (const s of e.nextStates) {
                                    collectSkippedStates(t, s);
                                }
                            }
                            break;
                        }
                    }
                }
            }
        }
        collectSkippedStates(this.skippedStates, this.head);
        if (!this.isConstrained) return true;
        this.u();
        return this.satisfiesConstraints;
    }
    u() {
        let t = this.params;
        if (t != null) return t;
        const {states: e, chars: s, endpoint: i} = this;
        t = {};
        this.satisfiesConstraints = true;
        for (const e of i.params) {
            t[e.name] = void 0;
        }
        for (let i = 0, n = e.length; i < n; ++i) {
            const n = e[i];
            if (n.isDynamic) {
                const r = n.segment;
                const o = r.name;
                if (t[o] === void 0) {
                    t[o] = s[i];
                } else {
                    t[o] += s[i];
                }
                const l = n.isConstrained && !Object.is(e[i + 1]?.segment, r);
                if (!l) continue;
                this.satisfiesConstraints = this.satisfiesConstraints && n.satisfiesConstraint(t[o]);
            }
        }
        if (this.satisfiesConstraints) {
            this.params = t;
        }
        return t;
    }
    compareTo(t) {
        const e = this.states;
        const s = t.states;
        for (let t = 0, i = 0, n = Math.max(e.length, s.length); t < n; ++t) {
            let n = e[t];
            if (n === void 0) {
                return 1;
            }
            let r = s[i];
            if (r === void 0) {
                return -1;
            }
            let o = n.segment;
            let l = r.segment;
            if (o === null) {
                if (l === null) {
                    ++i;
                    continue;
                }
                if ((n = e[++t]) === void 0) {
                    return 1;
                }
                o = n.segment;
            } else if (l === null) {
                if ((r = s[++i]) === void 0) {
                    return -1;
                }
                l = r.segment;
            }
            if (o.kind < l.kind) {
                return 1;
            }
            if (o.kind > l.kind) {
                return -1;
            }
            ++i;
        }
        const i = this.skippedStates;
        const n = t.skippedStates;
        const r = i.length;
        const o = n.length;
        if (r < o) {
            return 1;
        }
        if (r > o) {
            return -1;
        }
        for (let t = 0; t < r; ++t) {
            const e = i[t];
            const s = n[t];
            if (e.length < s.length) {
                return 1;
            }
            if (e.length > s.length) {
                return -1;
            }
        }
        return 0;
    }
}

function hasEndpoint(t) {
    return t.head.endpoint !== null;
}

function compareChains(t, e) {
    return t.compareTo(e);
}

class RecognizeResult {
    get isEmpty() {
        return this.candidates.length === 0;
    }
    constructor(t) {
        this.candidates = [];
        this.candidates = [ new Candidate([ "" ], [ t ], [], this) ];
    }
    getSolution() {
        const t = this.candidates.filter((t => hasEndpoint(t) && t.i()));
        if (t.length === 0) {
            return null;
        }
        t.sort(compareChains);
        return t[0];
    }
    add(t) {
        this.candidates.push(t);
    }
    remove(t) {
        this.candidates.splice(this.candidates.indexOf(t), 1);
    }
    advance(t) {
        const e = this.candidates.slice();
        for (const s of e) {
            s.advance(t);
        }
    }
}

const t = "$$residue";

const e = /^:(?<name>[^?\s{}]+)(?:\{\{(?<constraint>.+)\}\})?(?<optional>\?)?$/g;

class RouteRecognizer {
    constructor() {
        this.rootState = new State(null, null, "");
        this.cache = new Map;
        this.endpointLookup = new Map;
    }
    add(e, s = false) {
        let i;
        let n;
        if (e instanceof Array) {
            for (const r of e) {
                n = this.$add(r, false);
                i = n.params;
                if (!s || (i[i.length - 1]?.isStar ?? false)) continue;
                n.residualEndpoint = this.$add({
                    ...r,
                    path: `${r.path}/*${t}`
                }, true);
            }
        } else {
            n = this.$add(e, false);
            i = n.params;
            if (s && !(i[i.length - 1]?.isStar ?? false)) {
                n.residualEndpoint = this.$add({
                    ...e,
                    path: `${e.path}/*${t}`
                }, true);
            }
        }
        this.cache.clear();
    }
    $add(s, i) {
        const n = s.path;
        const r = this.endpointLookup;
        if (r.has(n)) throw createError(`Cannot add duplicate path '${n}'.`);
        const o = new ConfigurableRoute(n, s.caseSensitive === true, s.handler);
        const l = n === "" ? [ "" ] : n.split("/").filter(isNotEmpty);
        const a = [];
        let u = this.rootState;
        for (const s of l) {
            u = u.append(null, "/");
            switch (s.charAt(0)) {
              case ":":
                {
                    e.lastIndex = 0;
                    const i = e.exec(s);
                    const {name: n, optional: r} = i?.groups ?? {};
                    const o = r === "?";
                    if (n === t) throw new Error(`Invalid parameter name; usage of the reserved parameter name '${t}' is used.`);
                    const l = i?.groups?.constraint;
                    const h = l != null ? new RegExp(l) : null;
                    a.push(new Parameter(n, o, false, h));
                    u = new DynamicSegment(n, o, h).appendTo(u);
                    break;
                }

              case "*":
                {
                    const e = s.slice(1);
                    let n;
                    if (e === t) {
                        if (!i) throw new Error(`Invalid parameter name; usage of the reserved parameter name '${t}' is used.`);
                        n = 1;
                    } else {
                        n = 2;
                    }
                    a.push(new Parameter(e, true, true, null));
                    u = new StarSegment(e, n).appendTo(u);
                    break;
                }

              default:
                {
                    u = new StaticSegment(s, o.caseSensitive).appendTo(u);
                    break;
                }
            }
        }
        const h = new Endpoint(o, a);
        u.setEndpoint(h);
        r.set(n, h);
        return h;
    }
    recognize(t) {
        let e = this.cache.get(t);
        if (e === void 0) {
            this.cache.set(t, e = this.$recognize(t));
        }
        return e;
    }
    $recognize(t) {
        t = decodeURI(t);
        if (!t.startsWith("/")) {
            t = `/${t}`;
        }
        if (t.length > 1 && t.endsWith("/")) {
            t = t.slice(0, -1);
        }
        const e = new RecognizeResult(this.rootState);
        for (let s = 0, i = t.length; s < i; ++s) {
            const i = t.charAt(s);
            e.advance(i);
            if (e.isEmpty) {
                return null;
            }
        }
        const s = e.getSolution();
        if (s === null) {
            return null;
        }
        const {endpoint: i} = s;
        const n = s.u();
        return new RecognizedRoute(i, n);
    }
    getEndpoint(t) {
        return this.endpointLookup.get(t) ?? null;
    }
}

class State {
    constructor(t, e, s) {
        this.prevState = t;
        this.segment = e;
        this.value = s;
        this.nextStates = null;
        this.endpoint = null;
        this.isConstrained = false;
        switch (e?.kind) {
          case 3:
            this.length = t.length + 1;
            this.isSeparator = false;
            this.isDynamic = true;
            this.isOptional = e.optional;
            this.isConstrained = e.isConstrained;
            break;

          case 2:
          case 1:
            this.length = t.length + 1;
            this.isSeparator = false;
            this.isDynamic = true;
            this.isOptional = false;
            break;

          case 4:
            this.length = t.length + 1;
            this.isSeparator = false;
            this.isDynamic = false;
            this.isOptional = false;
            break;

          case undefined:
            this.length = t === null ? 0 : t.length;
            this.isSeparator = true;
            this.isDynamic = false;
            this.isOptional = false;
            break;
        }
    }
    append(t, e) {
        let s;
        let i = this.nextStates;
        if (i === null) {
            s = void 0;
            i = this.nextStates = [];
        } else if (t === null) {
            s = i.find((t => t.value === e));
        } else {
            s = i.find((e => e.segment?.equals(t)));
        }
        if (s === void 0) {
            i.push(s = new State(this, t, e));
        }
        return s;
    }
    setEndpoint(t) {
        if (this.endpoint !== null) {
            throw createError(`Cannot add ambiguous route. The pattern '${t.route.path}' clashes with '${this.endpoint.route.path}'`);
        }
        this.endpoint = t;
        if (this.isOptional) {
            this.prevState.setEndpoint(t);
            if (this.prevState.isSeparator && this.prevState.prevState !== null) {
                this.prevState.prevState.setEndpoint(t);
            }
        }
    }
    isMatch(t) {
        const e = this.segment;
        switch (e?.kind) {
          case 3:
            return !this.value.includes(t);

          case 2:
          case 1:
            return true;

          case 4:
          case undefined:
            return this.value.includes(t);
        }
    }
    satisfiesConstraint(t) {
        return this.isConstrained ? this.segment.satisfiesPattern(t) : true;
    }
}

function isNotEmpty(t) {
    return t.length > 0;
}

class StaticSegment {
    get kind() {
        return 4;
    }
    constructor(t, e) {
        this.value = t;
        this.caseSensitive = e;
    }
    appendTo(t) {
        const {value: e, value: {length: s}} = this;
        if (this.caseSensitive) {
            for (let i = 0; i < s; ++i) {
                t = t.append(this, e.charAt(i));
            }
        } else {
            for (let i = 0; i < s; ++i) {
                const s = e.charAt(i);
                t = t.append(this, s.toUpperCase() + s.toLowerCase());
            }
        }
        return t;
    }
    equals(t) {
        return t.kind === 4 && t.caseSensitive === this.caseSensitive && t.value === this.value;
    }
}

class DynamicSegment {
    get kind() {
        return 3;
    }
    constructor(t, e, s) {
        this.name = t;
        this.optional = e;
        this.pattern = s;
        if (s === void 0) throw new Error(`Pattern is undefined`);
        this.isConstrained = s !== null;
    }
    appendTo(t) {
        t = t.append(this, "/");
        return t;
    }
    equals(t) {
        return t.kind === 3 && t.optional === this.optional && t.name === this.name;
    }
    satisfiesPattern(t) {
        if (this.pattern === null) return true;
        this.pattern.lastIndex = 0;
        return this.pattern.test(t);
    }
}

class StarSegment {
    constructor(t, e) {
        this.name = t;
        this.kind = e;
    }
    appendTo(t) {
        t = t.append(this, "");
        return t;
    }
    equals(t) {
        return (t.kind === 2 || t.kind === 1) && t.name === this.name;
    }
}

const createError = t => new Error(t);

export { ConfigurableRoute, Endpoint, Parameter, t as RESIDUE, RecognizedRoute, RouteRecognizer };
//# sourceMappingURL=index.mjs.map
