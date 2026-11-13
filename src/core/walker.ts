// Scores one function: cognitive complexity (SonarSource), cyclomatic complexity (McCabe),
// maximum nesting depth, and the list of places that add to the cognitive score.

import * as ts from "typescript";
import { FnNode, isFunctionNode, ownName } from "./names";

/** One place that adds to cognitive complexity. */
export interface Increment {
  line: number;
  endLine: number;
  /** if, else if, else, ternary, switch, for, while, do, catch, &&, ||, ??, labelled jump */
  kind: string;
  /** Points added here (1 + nesting for structures). */
  points: number;
  nesting: number;
}

const LOGICAL = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);
const MAX_INCREMENTS = 200;

const LOOP_KIND: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.ForStatement]: "for",
  [ts.SyntaxKind.ForInStatement]: "for…in",
  [ts.SyntaxKind.ForOfStatement]: "for…of",
  [ts.SyntaxKind.WhileStatement]: "while",
  [ts.SyntaxKind.DoStatement]: "do…while",
};

const parentSkippingParens = (n: ts.Node): ts.Node => {
  let cur = n.parent;
  while (cur && ts.isParenthesizedExpression(cur)) cur = cur.parent;
  return cur;
};

export class FunctionWalker {
  cognitive = 0;
  /** Starts at 1 (one path through the function). */
  cyclomatic = 1;
  maxDepth = 0;
  readonly increments: Increment[] = [];

  constructor(
    private readonly root: FnNode,
    private readonly sf: ts.SourceFile,
  ) {}

  run(): this {
    if (this.root.body) this.visit(this.root.body, 0, 0);
    return this;
  }

  private lineOf(pos: number): number {
    return this.sf.getLineAndCharacterOfPosition(pos).line + 1;
  }

  private add(n: ts.Node, kind: string, points: number, nesting: number): void {
    this.cognitive += points;
    if (this.increments.length >= MAX_INCREMENTS) return;
    this.increments.push({ line: this.lineOf(n.getStart(this.sf)), endLine: this.lineOf(n.getEnd()), kind, points, nesting });
  }

  private structure(n: ts.Node, kind: string, nesting: number, depth: number, children: readonly ts.Node[]): void {
    this.add(n, kind, 1 + nesting, nesting);
    this.cyclomatic += 1;
    this.maxDepth = Math.max(this.maxDepth, depth + 1);
    for (const c of children) this.visit(c, nesting + 1, depth + 1);
  }

  private visitIf(n: ts.IfStatement, nesting: number, depth: number, isElseIf: boolean): void {
    this.add(n, isElseIf ? "else if" : "if", isElseIf ? 1 : 1 + nesting, nesting);
    this.cyclomatic += 1;
    this.maxDepth = Math.max(this.maxDepth, depth + 1);
    this.visit(n.expression, nesting, depth);
    this.visit(n.thenStatement, nesting + 1, depth + 1);
    const e = n.elseStatement;
    if (!e) return;
    if (ts.isIfStatement(e)) return this.visitIf(e, nesting, depth, true);
    this.add(e, "else", 1, nesting);
    this.visit(e, nesting + 1, depth + 1);
  }

  private visitLogical(n: ts.BinaryExpression, nesting: number): void {
    this.cyclomatic += 1;
    const parent = parentSkippingParens(n);
    const sameChain = parent && ts.isBinaryExpression(parent) && parent.operatorToken.kind === n.operatorToken.kind;
    if (!sameChain) this.add(n, n.operatorToken.getText(this.sf), 1, nesting);
  }

  /** Handles flow structures; returns true when the node's children were already visited. */
  private visitStructure(n: ts.Node, nesting: number, depth: number): boolean {
    if (ts.isIfStatement(n)) {
      this.visitIf(n, nesting, depth, false);
      return true;
    }
    if (ts.isConditionalExpression(n)) {
      this.visit(n.condition, nesting, depth);
      this.structure(n, "ternary", nesting, depth, [n.whenTrue, n.whenFalse]);
      return true;
    }
    if (ts.isSwitchStatement(n)) {
      this.visit(n.expression, nesting, depth);
      this.structure(n, "switch", nesting, depth, [n.caseBlock]);
      this.cyclomatic -= 1; // cyclomatic counts the cases instead of the switch
      return true;
    }
    const loop = LOOP_KIND[n.kind];
    if (loop) {
      this.structure(n, loop, nesting, depth, n.getChildren(this.sf));
      return true;
    }
    if (ts.isCatchClause(n)) {
      this.structure(n, "catch", nesting, depth, [n.block]);
      return true;
    }
    return false;
  }

  // complexity-ok: one dispatch per syntax kind; splitting it would scatter the scoring rules
  visit(n: ts.Node, nesting: number, depth: number): void {
    if (isFunctionNode(n) && n !== this.root) {
      // Named inner functions are measured separately; anonymous callbacks add nesting.
      if (ownName(n) === undefined && n.body) this.visit(n.body, nesting + 1, depth);
      return;
    }
    if (ts.isClassLike(n)) return; // classes inside a function are measured on their own
    if (this.visitStructure(n, nesting, depth)) return;
    if (ts.isCaseClause(n)) this.cyclomatic += 1;
    if ((ts.isBreakStatement(n) || ts.isContinueStatement(n)) && n.label) this.add(n, "labelled jump", 1, nesting);
    if (ts.isBinaryExpression(n) && LOGICAL.has(n.operatorToken.kind)) this.visitLogical(n, nesting);
    ts.forEachChild(n, (c) => this.visit(c, nesting, depth));
  }
}
