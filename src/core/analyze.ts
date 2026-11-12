// Measures files and functions with the TypeScript compiler's parser (no type checking,
// no code execution). Cognitive complexity follows the published SonarSource rules:
//   +1 for each break in linear flow (if, else if, else, ternary, switch, loops, catch,
//      labelled break/continue, each sequence of mixed && / || / ??),
//   +nesting for structures nested inside other flow structures or callbacks.
// Named functions (declarations, methods, functions assigned to a name) are measured on
// their own; anonymous callbacks count toward the function that contains them.

import * as ts from "typescript";

export interface FunctionMetrics {
  /** Stable key used to match the same function across versions, e.g. "Parser.parse". */
  key: string;
  name: string;
  line: number;
  endLine: number;
  cognitiveComplexity: number;
  functionLines: number;
  nestingDepth: number;
  parameters: number;
  /** Text after the allow marker (e.g. "parser state machine"), or "" when present without a reason. */
  allowReason?: string;
}

export interface FileMetrics {
  path: string;
  fileLines: number;
  fileTokens: number;
  imports: number;
  /** Module specifiers of relative imports, used to estimate AI reading cost. */
  relativeImports: string[];
  functions: FunctionMetrics[];
}

/** Rough token estimate for source code (~3.5 characters per token). Never exact. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function scriptKindFor(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  if (/\.[mc]?js$/i.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

type FnNode = ts.FunctionLikeDeclaration;

const isFunctionNode = (n: ts.Node): n is FnNode =>
  ts.isFunctionDeclaration(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n);

const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

const unwrapParens = (n: ts.Node): ts.Node => {
  let cur = n.parent;
  while (cur && ts.isParenthesizedExpression(cur)) cur = cur.parent;
  return cur;
};

function propName(
  name: ts.PropertyName | ts.BindingName | undefined,
): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function className(n: ts.Node): string | undefined {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isClassLike(p)) return p.name?.text ?? "(class)";
    if (isFunctionNode(p)) return undefined;
  }
  return undefined;
}

/** Name for a function that is measured on its own, or undefined for anonymous callbacks. */
/** Name for methods, accessors, constructors and function declarations. */
function declaredName(fn: FnNode, prefix: string): string | undefined {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? "default";
  if (ts.isConstructorDeclaration(fn)) return `${prefix}constructor`;
  if (ts.isMethodDeclaration(fn)) return `${prefix}${propName(fn.name) ?? "(method)"}`;
  if (ts.isGetAccessorDeclaration(fn)) return `${prefix}get ${propName(fn.name) ?? "?"}`;
  if (ts.isSetAccessorDeclaration(fn)) return `${prefix}set ${propName(fn.name) ?? "?"}`;
  return undefined;
}

/** Name for a function expression or arrow function taken from where it is assigned. */
function assignedName(fn: FnNode, prefix: string): string | undefined {
  const p = fn.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) return propName(p.name);
  if (ts.isPropertyDeclaration(p)) return `${prefix}${propName(p.name) ?? "(property)"}`;
  if (ts.isExportAssignment(p)) return "default";
  const isAssignment = ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === fn;
  return isAssignment ? p.left.getText().slice(0, 80) : undefined;
}

/** Name for a function that is measured on its own, or undefined for anonymous callbacks. */
function ownName(fn: FnNode): string | undefined {
  const cls = className(fn);
  const prefix = cls ? `${cls}.` : "";
  return declaredName(fn, prefix) ?? assignedName(fn, prefix);
}

class FunctionWalker {
  complexity = 0;
  maxDepth = 0;

  constructor(private readonly root: FnNode) {}

  run(): void {
    if (this.root.body) this.visit(this.root.body, 0, 0);
  }

  private structure(
    n: ts.Node,
    nesting: number,
    depth: number,
    children: ts.Node[],
  ): void {
    this.complexity += 1 + nesting;
    this.maxDepth = Math.max(this.maxDepth, depth + 1);
    for (const c of children) this.visit(c, nesting + 1, depth + 1);
    void n;
  }

  private visitIf(
    n: ts.IfStatement,
    nesting: number,
    depth: number,
    isElseIf: boolean,
  ): void {
    this.complexity += isElseIf ? 1 : 1 + nesting;
    this.maxDepth = Math.max(this.maxDepth, depth + 1);
    this.visit(n.expression, nesting, depth);
    this.visit(n.thenStatement, nesting + 1, depth + 1);
    const e = n.elseStatement;
    if (!e) return;
    if (ts.isIfStatement(e)) this.visitIf(e, nesting, depth, true);
    else {
      this.complexity += 1;
      this.visit(e, nesting + 1, depth + 1);
    }
  }

  // complexity-ok: one dispatch per syntax kind; splitting it would scatter the scoring rules
  visit(n: ts.Node, nesting: number, depth: number): void {
    if (isFunctionNode(n) && n !== this.root) {
      // Named inner functions are measured separately; anonymous callbacks add nesting.
      if (ownName(n) === undefined && n.body)
        this.visit(n.body, nesting + 1, depth);
      return;
    }
    if (ts.isClassLike(n)) return; // classes inside a function are measured on their own

    if (ts.isIfStatement(n)) return this.visitIf(n, nesting, depth, false);
    if (ts.isConditionalExpression(n)) {
      this.visit(n.condition, nesting, depth);
      return this.structure(n, nesting, depth, [n.whenTrue, n.whenFalse]);
    }
    if (ts.isSwitchStatement(n)) {
      this.visit(n.expression, nesting, depth);
      return this.structure(n, nesting, depth, [n.caseBlock]);
    }
    if (
      ts.isForStatement(n) ||
      ts.isForInStatement(n) ||
      ts.isForOfStatement(n) ||
      ts.isWhileStatement(n) ||
      ts.isDoStatement(n)
    ) {
      return this.structure(n, nesting, depth, [...n.getChildren()]);
    }
    if (ts.isCatchClause(n))
      return this.structure(n, nesting, depth, [n.block]);
    if ((ts.isBreakStatement(n) || ts.isContinueStatement(n)) && n.label)
      this.complexity += 1;
    if (ts.isBinaryExpression(n) && LOGICAL.has(n.operatorToken.kind)) {
      const parent = unwrapParens(n);
      const sameChain =
        parent &&
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === n.operatorToken.kind;
      if (!sameChain) this.complexity += 1;
    }
    ts.forEachChild(n, (c) => this.visit(c, nesting, depth));
  }
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

function countImports(sf: ts.SourceFile): {
  count: number;
  relative: string[];
} {
  const specs: string[] = [];
  const visit = (n: ts.Node): void => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
      specs.push(n.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(n) &&
      n.arguments.length === 1 &&
      ts.isStringLiteral(n.arguments[0]) &&
      ((ts.isIdentifier(n.expression) && n.expression.text === "require") ||
        n.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      specs.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const unique = [...new Set(specs)];
  return {
    count: unique.length,
    relative: unique.filter((s) => s.startsWith("./") || s.startsWith("../")),
  };
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
  const lineOf = (pos: number) =>
    sf.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (n: ts.Node): void => {
    if (isFunctionNode(n) && n.body) {
      const name = ownName(n);
      if (name !== undefined) {
        const w = new FunctionWalker(n);
        w.run();
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        const line = lineOf(n.getStart(sf));
        const endLine = lineOf(n.getEnd());
        functions.push({
          key: count > 1 ? `${name}#${count}` : name,
          name,
          line,
          endLine,
          cognitiveComplexity: w.complexity,
          functionLines: endLine - line + 1,
          nestingDepth: w.maxDepth,
          parameters: n.parameters.filter(
            (p) => !(ts.isIdentifier(p.name) && p.name.text === "this"),
          ).length,
          allowReason: allowReasonFor(n, sf, allowMarker),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  const imports = countImports(sf);
  return {
    path,
    fileLines: text.length === 0 ? 0 : text.split("\n").length,
    fileTokens: estimateTokens(text),
    imports: imports.count,
    relativeImports: imports.relative,
    functions,
  };
}
