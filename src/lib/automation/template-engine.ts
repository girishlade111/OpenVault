/**
 * Template engine.
 *
 * Parses a template file and replaces variables with dynamic values:
 *  - {{date}}      → today's date (YYYY-MM-DD)
 *  - {{date:fmt}}  → formatted date (e.g. {{date:MMMM Do YYYY}})
 *  - {{time}}      → current time (HH:mm)
 *  - {{time:fmt}}  → formatted time
 *  - {{title}}     → the note's title (filename without extension)
 *  - {{cursor}}    → marks where the cursor should land after insertion
 *
 * The engine is pure: `renderTemplate(template, vars)` returns the rendered
 * string + cursor position. The caller inserts it into the editor.
 */

export interface TemplateVars {
  /** Note title (filename without extension). */
  title: string;
  /** Date to use for {{date}} (defaults to now). */
  date?: Date;
}

export interface RenderedTemplate {
  text: string;
  /** Character offset where the cursor should be placed, or null. */
  cursorOffset: number | null;
}

/** Render a template string with variable substitution. */
export function renderTemplate(template: string, vars: TemplateVars): RenderedTemplate {
  const now = vars.date ?? new Date();
  let cursorOffset: number | null = null;
  let result = "";

  // We scan for {{...}} and build the result incrementally, tracking cursor.
  const re = /\{\{([^}]+)\}\}/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(template)) !== null) {
    // Append text before the match.
    result += template.slice(lastEnd, match.index);
    const expr = match[1].trim();
    const lower = expr.toLowerCase();

    if (lower === "cursor") {
      cursorOffset = result.length;
      // Don't insert anything — the cursor marker is consumed.
    } else if (lower.startsWith("date")) {
      const fmt = expr.includes(":") ? expr.slice(expr.indexOf(":") + 1).trim() : "YYYY-MM-DD";
      result += formatDate(now, fmt);
    } else if (lower.startsWith("time")) {
      const fmt = expr.includes(":") ? expr.slice(expr.indexOf(":") + 1).trim() : "HH:mm";
      result += formatDate(now, fmt);
    } else if (lower === "title") {
      result += vars.title;
    } else {
      // Unknown variable — leave it as-is.
      result += match[0];
    }
    lastEnd = match.index + match[0].length;
  }
  result += template.slice(lastEnd);

  return { text: result, cursorOffset };
}

/**
 * Format a Date using a subset of Moment.js-style format tokens.
 * Supported: YYYY, YY, MM, DD, HH, mm, ss, M, D, MMMM, MMM, Do, dddd, ddd
 */
export function formatDate(date: Date, format: string): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthsShort = months.map((m) => m.slice(0, 3));
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const daysShort = days.map((d) => d.slice(0, 3));

  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ordinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  let out = "";
  let i = 0;
  while (i < format.length) {
    // Try to match the longest token at this position.
    let matched = false;
    const tokens: [string, string][] = [
      ["YYYY", String(date.getFullYear())],
      ["YY", pad(date.getFullYear() % 100)],
      ["MMMM", months[date.getMonth()]],
      ["MMM", monthsShort[date.getMonth()]],
      ["MM", pad(date.getMonth() + 1)],
      ["M", String(date.getMonth() + 1)],
      ["dddd", days[date.getDay()]],
      ["ddd", daysShort[date.getDay()]],
      ["Do", ordinal(date.getDate())],
      ["DD", pad(date.getDate())],
      ["D", String(date.getDate())],
      ["HH", pad(date.getHours())],
      ["H", String(date.getHours())],
      ["mm", pad(date.getMinutes())],
      ["m", String(date.getMinutes())],
      ["ss", pad(date.getSeconds())],
      ["s", String(date.getSeconds())],
    ];
    for (const [token, value] of tokens) {
      if (format.slice(i, i + token.length) === token) {
        out += value;
        i += token.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += format[i];
      i++;
    }
  }
  return out;
}

/** Default daily-note template. */
export const DEFAULT_DAILY_TEMPLATE = `# {{date}}

## Tasks
- [ ] 

## Notes

`;

/** Default new-note template. */
export const DEFAULT_NOTE_TEMPLATE = `# {{title}}

`;
