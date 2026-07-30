/**
 * Search query AST parser.
 *
 * Parses a search query string into an Abstract Syntax Tree that supports:
 *  - Boolean operators: AND, OR, NOT (uppercase = operator, lowercase = term)
 *  - Parenthesized grouping: `(term1 OR term2) AND term3`
 *  - Field operators: `file:`, `path:`, `tag:`, `line:`, `content:`
 *  - Regex flags: `/pattern/`
 *  - Quoted phrases: `"exact phrase"`
 *  - Bare terms: implicit AND between consecutive terms
 *
 * Grammar (simplified):
 *   query    := orExpr
 *   orExpr   := andExpr (OR andExpr)*
 *   andExpr  := notExpr (AND? notExpr)*       // AND is optional (implicit)
 *   notExpr  := NOT? primary
 *   primary  := '(' orExpr ')' | field | phrase | term | regex
 *   field    := (file|path|tag|line|content) ':' value
 *   phrase   := '"' ... '"'
 *   regex    := '/' ... '/'
 *
 * The AST is a discriminated union consumed by the executor.
 */

/** Discriminated union of AST node types. */
export type SearchNode =
  | { type: "term"; value: string; negated: boolean }
  | { type: "phrase"; value: string; negated: boolean }
  | { type: "regex"; pattern: string; negated: boolean }
  | { type: "field"; field: SearchField; value: string; negated: boolean }
  | { type: "and"; children: SearchNode[] }
  | { type: "or"; children: SearchNode[] }
  | { type: "not"; child: SearchNode };

/** Supported field operators. */
export type SearchField = "file" | "path" | "tag" | "line" | "content";

/** Parse a query string into an AST. Returns null for empty/whitespace. */
export function parseQuery(query: string): SearchNode | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  const parser = new Parser(tokens);
  const result = parser.parseOr();
  return result;
}

// --- tokenizer -------------------------------------------------------------

interface Token {
  type:
    | "word"
    | "phrase"
    | "regex"
    | "field"
    | "and"
    | "or"
    | "not"
    | "lparen"
    | "rparen";
  value: string;
  field?: SearchField;
}

const FIELD_NAMES = new Set(["file", "path", "tag", "line", "content"]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    // Skip whitespace.
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }
    // Parentheses.
    if (input[i] === "(") {
      tokens.push({ type: "lparen", value: "(" });
      i++;
      continue;
    }
    if (input[i] === ")") {
      tokens.push({ type: "rparen", value: ")" });
      i++;
      continue;
    }
    // Quoted phrase.
    if (input[i] === '"') {
      const end = input.indexOf('"', i + 1);
      if (end === -1) {
        // Unterminated — treat rest as phrase.
        tokens.push({ type: "phrase", value: input.slice(i + 1) });
        break;
      }
      tokens.push({ type: "phrase", value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    // Regex /pattern/
    if (input[i] === "/") {
      const end = input.indexOf("/", i + 1);
      if (end === -1) {
        // Treat as a term starting with /.
        tokens.push({ type: "word", value: input.slice(i) });
        break;
      }
      tokens.push({ type: "regex", value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    // Read a word (may be a boolean operator, field operator, or plain term).
    let word = "";
    while (i < input.length && !/[\s()"]/.test(input[i])) {
      word += input[i];
      i++;
    }
    // Check for field operator: "field:value"
    const colonIdx = word.indexOf(":");
    if (colonIdx > 0) {
      const prefix = word.slice(0, colonIdx).toLowerCase();
      if (FIELD_NAMES.has(prefix)) {
        tokens.push({
          type: "field",
          value: word.slice(colonIdx + 1),
          field: prefix as SearchField,
        });
        continue;
      }
    }
    // Check for boolean operators (must be uppercase to distinguish from terms).
    if (word === "AND") {
      tokens.push({ type: "and", value: "AND" });
    } else if (word === "OR") {
      tokens.push({ type: "or", value: "OR" });
    } else if (word === "NOT") {
      tokens.push({ type: "not", value: "NOT" });
    } else {
      tokens.push({ type: "word", value: word });
    }
  }
  return tokens;
}

// --- recursive descent parser ---------------------------------------------

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | null {
    return this.tokens[this.pos] ?? null;
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  parseOr(): SearchNode | null {
    const left = this.parseAnd();
    if (!left) return null;
    const children: SearchNode[] = [left];
    while (this.peek()?.type === "or") {
      this.next(); // consume OR
      const right = this.parseAnd();
      if (right) children.push(right);
    }
    if (children.length === 1) return children[0];
    return { type: "or", children };
  }

  parseAnd(): SearchNode | null {
    const left = this.parseNot();
    if (!left) return null;
    const children: SearchNode[] = [left];
    while (true) {
      const tok = this.peek();
      if (!tok) break;
      // Explicit AND.
      if (tok.type === "and") {
        this.next();
        const right = this.parseNot();
        if (right) children.push(right);
        continue;
      }
      // Implicit AND: if the next token starts a new primary (not OR/NOT/closing).
      if (tok.type === "or" || tok.type === "not" || tok.type === "rparen") break;
      const right = this.parseNot();
      if (right) children.push(right);
    }
    if (children.length === 1) return children[0];
    return { type: "and", children };
  }

  parseNot(): SearchNode | null {
    if (this.peek()?.type === "not") {
      this.next(); // consume NOT
      const child = this.parsePrimary();
      if (!child) return null;
      return { type: "not", child };
    }
    return this.parsePrimary();
  }

  parsePrimary(): SearchNode | null {
    const tok = this.peek();
    if (!tok) return null;
    if (tok.type === "lparen") {
      this.next();
      const inner = this.parseOr();
      if (this.peek()?.type === "rparen") this.next();
      return inner;
    }
    if (tok.type === "word") {
      this.next();
      return { type: "term", value: tok.value.toLowerCase(), negated: false };
    }
    if (tok.type === "phrase") {
      this.next();
      return { type: "phrase", value: tok.value.toLowerCase(), negated: false };
    }
    if (tok.type === "regex") {
      this.next();
      return { type: "regex", pattern: tok.value, negated: false };
    }
    if (tok.type === "field") {
      this.next();
      return {
        type: "field",
        field: tok.field!,
        value: tok.value.toLowerCase(),
        negated: false,
      };
    }
    // Skip unexpected tokens (AND/OR/NOT at wrong position).
    this.next();
    return this.parsePrimary();
  }
}

/** Pretty-print a search AST for debugging. */
export function debugNode(node: SearchNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  switch (node.type) {
    case "term":
      return `${pad}term(${node.value})`;
    case "phrase":
      return `${pad}phrase("${node.value}")`;
    case "regex":
      return `${pad}regex(/${node.pattern}/)`;
    case "field":
      return `${pad}field(${node.field}:${node.value})`;
    case "and":
      return `${pad}AND\n${node.children.map((c) => debugNode(c, indent + 1)).join("\n")}`;
    case "or":
      return `${pad}OR\n${node.children.map((c) => debugNode(c, indent + 1)).join("\n")}`;
    case "not":
      return `${pad}NOT\n${debugNode(node.child, indent + 1)}`;
  }
}
