// Cohesion (LCOM4): how many unrelated groups of code live in one class or file.
//  - Class: methods are connected when one calls the other (this.m()) or both use the
//    same field (this.x). Constructors are left out, as is usual for LCOM4, and classes
//    with fewer than 3 methods are not judged.
//  - File (module): top-level functions and classes are connected when one refers to the
//    other or both use the same top-level variable.
// LCOM = number of connected groups. 1 = cohesive; 3 = three unrelated jobs.

import * as ts from "typescript";
import { estimateTokens } from "./tokens";
import { FnNode, isFunctionNode, simpleName } from "./names";

export interface CohesionGroup {
  /** Function keys or class names in this group. */
  members: string[];
  lines: number;
  tokens: number;
}

export interface Cohesion {
  scope: "module" | "class";
  /** Class name for class scope; "" for the module. */
  name: string;
  lcom: number;
  groups: CohesionGroup[];
}

/** Minimal union-find over string ids. */
class Groups {
  private parent = new Map<string, string>();
  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }
  find(id: string): string {
    let p = this.parent.get(id) ?? id;
    while (p !== (this.parent.get(p) ?? p)) p = this.parent.get(p) ?? p;
    this.parent.set(id, p);
    return p;
  }
  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    this.parent.set(this.find(a), this.find(b));
  }
  components(): string[][] {
    const out = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      out.set(root, [...(out.get(root) ?? []), id]);
    }
    return [...out.values()];
  }
}

/** Connects members that share any "resource" (a field, a variable or each other's name). */
function connect(members: Map<string, Set<string>>): string[][] {
  const g = new Groups();
  const owner = new Map<string, string>();
  for (const [id, uses] of members) {
    g.add(id);
    for (const r of uses) {
      const first = owner.get(r);
      if (first) g.union(first, id);
      else owner.set(r, id);
    }
  }
  return g.components();
}

function collect(body: ts.Node, visit: (n: ts.Node) => void): void {
  const walk = (n: ts.Node): void => {
    visit(n);
    ts.forEachChild(n, walk);
  };
  walk(body);
}

const span = (sf: ts.SourceFile, n: ts.Node) => ({
  lines: sf.getLineAndCharacterOfPosition(n.getEnd()).line - sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
  tokens: estimateTokens(n.getText(sf)),
});

function groupsFrom(components: string[][], sizes: Map<string, { lines: number; tokens: number }>): CohesionGroup[] {
  return components
    .map((members) => ({
      members,
      lines: members.reduce((n, m) => n + (sizes.get(m)?.lines ?? 0), 0),
      tokens: members.reduce((n, m) => n + (sizes.get(m)?.tokens ?? 0), 0),
    }))
    .sort((a, b) => b.tokens - a.tokens);
}

/** The function behind a class member (method, accessor, or arrow-function property). */
function memberFunction(m: ts.ClassElement): FnNode | undefined {
  if (isFunctionNode(m)) return m as FnNode;
  if (ts.isPropertyDeclaration(m) && m.initializer && isFunctionNode(m.initializer)) return m.initializer;
  return undefined;
}

/** Fields and methods a member uses through `this`, plus its own name. */
function memberUses(fn: FnNode, name: string): Set<string> {
  const uses = new Set<string>([`member:${name}`]);
  if (fn.body) {
    collect(fn.body, (n) => {
      if (ts.isPropertyAccessExpression(n) && n.expression.kind === ts.SyntaxKind.ThisKeyword) uses.add(`member:${n.name.text}`);
    });
  }
  return uses;
}

export function classCohesion(cls: ts.ClassLikeDeclaration, sf: ts.SourceFile): Cohesion | undefined {
  const members = new Map<string, Set<string>>();
  const sizes = new Map<string, { lines: number; tokens: number }>();
  const className = cls.name?.text ?? "(class)";
  for (const m of cls.members) {
    const fn = memberFunction(m);
    const name = fn && simpleName(fn);
    if (!fn?.body || !name || name === "constructor") continue;
    const id = `${className}.${name}`;
    members.set(id, memberUses(fn, name));
    sizes.set(id, span(sf, m));
  }
  // Small classes (fewer than 3 methods) give no meaningful cohesion signal.
  if (members.size < 3) return undefined;
  const comps = connect(members);
  return { scope: "class", name: className, lcom: comps.length, groups: groupsFrom(comps, sizes) };
}

type Unit = { id: string; node: ts.Node };

const isFunctionInit = (d: ts.VariableDeclaration) => !!d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer));

/** Top-level variables: function-valued ones are units, the rest is shared state. */
function addVariables(s: ts.VariableStatement, units: Unit[], state: Set<string>): void {
  for (const d of s.declarationList.declarations) {
    if (!ts.isIdentifier(d.name)) continue;
    if (isFunctionInit(d)) units.push({ id: d.name.text, node: d });
    else state.add(d.name.text);
  }
}

/** Top-level functions and classes (the units of a module), keyed by their declared name. */
function moduleUnits(sf: ts.SourceFile): { units: Unit[]; state: Set<string> } {
  const units: Unit[] = [];
  const state = new Set<string>();
  for (const s of sf.statements) {
    if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) units.push({ id: s.name.text, node: s });
    else if (ts.isVariableStatement(s)) addVariables(s, units, state);
  }
  return { units, state };
}

export function moduleCohesion(sf: ts.SourceFile): Cohesion | undefined {
  const { units, state } = moduleUnits(sf);
  if (units.length < 2) return undefined;
  const known = new Set([...units.map((u) => u.id), ...state]);
  const members = new Map<string, Set<string>>();
  const sizes = new Map<string, { lines: number; tokens: number }>();
  for (const u of units) {
    const uses = new Set<string>([u.id]);
    collect(u.node, (n) => {
      if (ts.isIdentifier(n) && known.has(n.text)) uses.add(n.text);
    });
    members.set(u.id, uses);
    sizes.set(u.id, span(sf, u.node));
  }
  const comps = connect(members);
  return { scope: "module", name: "", lcom: comps.length, groups: groupsFrom(comps, sizes) };
}
