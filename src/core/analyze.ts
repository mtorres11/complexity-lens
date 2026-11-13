// Measures files and functions with the TypeScript compiler's parser (no type checking,
// no code execution).
//   Per function: cognitive complexity (SonarSource), cyclomatic complexity (McCabe),
//                 nesting depth, lines, parameters, where the complexity is, calls.
//   Per file:     lines, estimated tokens, imports (efferent coupling), cohesion (LCOM4).
// Named functions (declarations, methods, functions assigned to a name) are measured on
// their own; anonymous callbacks count toward the function that contains them.

import * as ts from "typescript";
import { classCohesion, Cohesion, moduleCohesion } from "./cohesion";
import { countImports, FnNode, isFunctionNode, ownName } from "./names";
import { estimateTokens } from "./tokens";
import { FunctionWalker, Increment } from "./walker";

export { estimateTokens } from "./tokens";
export type { Increment } from "./walker";
export type { Cohesion, CohesionGroup } from "./cohesion";

export interface FunctionMetrics {
  /** Stable key used to match the same function across versions, e.g. "Parser.parse". */
  key: string;
  name: string;
  line: number;
  endLine: number;
  cognitiveComplexity: number;
  cyclomaticComplexity: number;
  functionLines: number;
  nestingDepth: number;
  parameters: number;
  /** Places that add to cognitive complexity (capped). */
  increments: Increment[];
  /** Names this function calls: plain functions ("helper") and own members ("this.save"). */
  calls: string[];
  /** Text after the allow marker (e.g. "parser state machine"), or "" when present without a reason. */
  allowReason?: string;
}

export interface FileMetrics {
  path: string;
  fileLines: number;
  fileTokens: number;
  /** Efferent coupling: distinct modules this file imports. */
  imports: number;
  /** Module specifiers of relative imports, used for AI cost and afferent coupling. */
  relativeImports: string[];
  /** Highest LCOM among the module and its classes (1 = cohesive, 0 = nothing to judge). */
  lcom: number;
  cohesion: Cohesion[];
  functions: FunctionMetrics[];
  /** Estimated tokens to read the file plus its imports; filled in by the project. */
  contextTokens?: number;
  /** Largest counted import, used to advise when imports dominate the context load. */
  contextLargestImport?: { path: string; tokens: number };
}

export function scriptKindFor(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  if (/\.[mc]?js$/i.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function allowReasonFor(
  fn: FnNode,
  sf: ts.SourceFile,
  marker: string,
): string | undefined {
  // Look at comments directly above the function, or above its variable/property statement.
  let anchor: ts.Node = fn;
  if (ts.isVariableDeclaration(fn.parent))
    anchor = fn.parent.parent?.parent ?? fn;
  else if (
    ts.isPropertyAssignment(fn.parent) ||
    ts.isPropertyDeclaration(fn.parent)
  )
    anchor = fn.parent;
  const ranges =
    ts.getLeadingCommentRanges(sf.text, anchor.getFullStart()) ?? [];
  const re = new RegExp(`${marker}(?::\\s*(.*))?`);
  for (const r of ranges) {
    const m = re.exec(sf.text.slice(r.pos, r.end));
    if (m) return (m[1] ?? "").replace(/\*\/\s*$/, "").trim();
  }
  return undefined;
}

/** Plain function calls and calls to own members, inside the function body. */
function callsIn(fn: FnNode): string[] {
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) out.add(e.text);
      else if (
        ts.isPropertyAccessExpression(e) &&
        e.expression.kind === ts.SyntaxKind.ThisKeyword
      )
        out.add(`this.${e.name.text}`);
    }
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return [...out];
}

function measure(
  n: FnNode,
  sf: ts.SourceFile,
  key: string,
  name: string,
  marker: string,
): FunctionMetrics {
  const w = new FunctionWalker(n, sf).run();
  const lineOf = (pos: number) =>
    sf.getLineAndCharacterOfPosition(pos).line + 1;
  const line = lineOf(n.getStart(sf));
  const endLine = lineOf(n.getEnd());
  return {
    key,
    name,
    line,
    endLine,
    cognitiveComplexity: w.cognitive,
    cyclomaticComplexity: w.cyclomatic,
    functionLines: endLine - line + 1,
    nestingDepth: w.maxDepth,
    parameters: n.parameters.filter(
      (p) => !(ts.isIdentifier(p.name) && p.name.text === "this"),
    ).length,
    increments: w.increments,
    calls: callsIn(n),
    allowReason: allowReasonFor(n, sf, marker),
  };
}

function cohesionOf(sf: ts.SourceFile): Cohesion[] {
  const out: Cohesion[] = [];
  const mod = moduleCohesion(sf);
  if (mod) out.push(mod);
  const visit = (n: ts.Node): void => {
    if (ts.isClassLike(n)) {
      const c = classCohesion(n, sf);
      if (c) out.push(c);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export function analyzeSource(
  path: string,
  text: string,
  allowMarker = "complexity-ok",
): FileMetrics {
  const sf = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(path),
  );
  const functions: FunctionMetrics[] = [];
  const seen = new Map<string, number>();
  const visit = (n: ts.Node): void => {
    const name = isFunctionNode(n) && n.body ? ownName(n) : undefined;
    if (name !== undefined) {
      const count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      functions.push(
        measure(
          n as FnNode,
          sf,
          count > 1 ? `${name}#${count}` : name,
          name,
          allowMarker,
        ),
      );
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  const imports = countImports(sf);
  const cohesion = cohesionOf(sf);
  return {
    path,
    fileLines: text.length === 0 ? 0 : text.split("\n").length,
    fileTokens: estimateTokens(text),
    imports: imports.count,
    relativeImports: imports.relative,
    lcom: Math.max(0, ...cohesion.map((c) => c.lcom)),
    cohesion,
    functions,
  };
}
