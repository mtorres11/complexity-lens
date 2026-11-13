// Function naming shared by the analyzer modules.

import * as ts from "typescript";

export type FnNode = ts.FunctionLikeDeclaration;

export const isFunctionNode = (n: ts.Node): n is FnNode =>
  ts.isFunctionDeclaration(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n);

export function propName(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

/** The class a function belongs to directly (not through an enclosing function). */
export function enclosingClass(n: ts.Node): ts.ClassLikeDeclaration | undefined {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isClassLike(p)) return p;
    if (isFunctionNode(p)) return undefined;
  }
  return undefined;
}

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
export function ownName(fn: FnNode): string | undefined {
  const cls = enclosingClass(fn);
  const prefix = cls ? `${cls.name?.text ?? "(class)"}.` : "";
  return declaredName(fn, prefix) ?? assignedName(fn, prefix);
}

/** The bare member or function name (without the class prefix), used for call matching. */
export function simpleName(fn: FnNode): string | undefined {
  if (ts.isConstructorDeclaration(fn)) return "constructor";
  if (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isGetAccessorDeclaration(fn) || ts.isSetAccessorDeclaration(fn)) {
    return propName(fn.name);
  }
  const p = fn.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) return propName(p.name);
  return undefined;
}

export function countImports(sf: ts.SourceFile): { count: number; relative: string[] } {
  const specs: string[] = [];
  const isRequireOrImport = (n: ts.CallExpression) =>
    n.arguments.length === 1 &&
    ts.isStringLiteral(n.arguments[0]) &&
    ((ts.isIdentifier(n.expression) && n.expression.text === "require") || n.expression.kind === ts.SyntaxKind.ImportKeyword);
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      specs.push(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n) && isRequireOrImport(n)) {
      specs.push((n.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const unique = [...new Set(specs)];
  return { count: unique.length, relative: unique.filter((s) => s.startsWith("./") || s.startsWith("../")) };
}
