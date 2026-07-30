/**
 * Daily notes automation.
 *
 * On app boot (or on user command), checks if a note matching today's date
 * format exists in the designated "Daily" folder. If not, creates it from the
 * daily template and opens it automatically.
 *
 * This is one of Obsidian's signature automations — it makes the daily note
 * a frictionless entry point into the vault.
 */

import { formatDate, renderTemplate } from "./template-engine";
import { DEFAULT_DAILY_TEMPLATE } from "./template-engine";

export interface DailyNotesConfig {
  /** Folder path for daily notes (e.g. "Daily"). */
  folder: string;
  /** Date format for the filename (e.g. "YYYY-MM-DD"). */
  format: string;
  /** Template text to use when creating a new daily note. */
  template: string;
}

export const DEFAULT_DAILY_CONFIG: DailyNotesConfig = {
  folder: "Daily",
  format: "YYYY-MM-DD",
  template: DEFAULT_DAILY_TEMPLATE,
};

/**
 * Get the path for today's daily note.
 * e.g. "Daily/2024-01-15.md"
 */
export function getDailyNotePath(config: DailyNotesConfig, date: Date = new Date()): string {
  const filename = formatDate(date, config.format);
  return `${config.folder}/${filename}.md`;
}

/**
 * Get the title for today's daily note (filename without extension).
 */
export function getDailyNoteTitle(config: DailyNotesConfig, date: Date = new Date()): string {
  return formatDate(date, config.format);
}

/**
 * Render the daily note content from the template.
 */
export function renderDailyNote(
  config: DailyNotesConfig,
  date: Date = new Date()
): string {
  const title = getDailyNoteTitle(config, date);
  return renderTemplate(config.template, { title, date }).text;
}

export { DEFAULT_DAILY_TEMPLATE };
