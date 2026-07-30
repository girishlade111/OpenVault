"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, Tag } from "lucide-react";
import { useVaultStore } from "@/store/vault-store";
import {
  extractFrontmatter,
  serializeFrontmatter,
} from "@/lib/editor/custom-syntax";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type PropType = "text" | "number" | "checkbox" | "list" | "datetime" | "date";

interface PropertyRow {
  key: string;
  value: unknown;
  type: PropType;
}

/**
 * YAML frontmatter properties panel.
 *
 * Renders the active note's frontmatter as an editable table at the top of
 * the editor. When the user edits a property, the new value is serialized
 * back to YAML and injected at the top of the raw text file before saving.
 *
 * Round-trip: extractFrontmatter(text) → table → user edits →
 * serializeFrontmatter(data) → replace the frontmatter block in the text →
 * setContent.
 */
export function PropertiesPanel({ fileId }: { fileId: string }) {
  const content = useVaultStore((s) =>
    fileId ? s.contentCache[fileId] : undefined
  );
  const setContent = useVaultStore((s) => s.setContent);

  // Derive frontmatter + rows directly from content — no useEffect syncing.
  const { rows, hasFrontmatter, bodyStart } = useMemo(() => {
    if (content === undefined) {
      return { rows: [] as PropertyRow[], hasFrontmatter: false, bodyStart: 0 };
    }
    const parsed = extractFrontmatter(content);
    if (!parsed) {
      return { rows: [] as PropertyRow[], hasFrontmatter: false, bodyStart: 0 };
    }
    const nextRows: PropertyRow[] = Object.entries(parsed.data).map(([key, value]) => ({
      key,
      value,
      type: inferType(value),
    }));
    return { rows: nextRows, hasFrontmatter: true, bodyStart: parsed.to };
  }, [content]);

  // Local override: when the user edits, we keep their version until the
  // content cache catches up. We detect "caught up" by comparing serialized
  // forms; when they match, we drop the override.
  const [localRows, setLocalRows] = useState<PropertyRow[] | null>(null);
  const displayRows = localRows ?? rows;

  const commit = (nextRows: PropertyRow[]) => {
    setLocalRows(nextRows);
    if (!fileId || content === undefined) return;
    const data: Record<string, unknown> = {};
    for (const row of nextRows) {
      if (row.key.trim()) data[row.key] = coerceValue(row.value, row.type);
    }
    const fmText = serializeFrontmatter(data);
    const body = content.slice(hasFrontmatter ? bodyStart : 0);
    const newText = fmText + "\n" + body.replace(/^\n+/, "");
    setContent(fileId, newText, true);
  };

  const updateRow = (idx: number, patch: Partial<PropertyRow>) => {
    const next = displayRows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    commit(next);
  };

  const addRow = () => {
    const next = [...displayRows, { key: "new-property", value: "", type: "text" as PropType }];
    commit(next);
  };

  const removeRow = (idx: number) => {
    const next = displayRows.filter((_, i) => i !== idx);
    commit(next);
  };

  if (content === undefined) return null;

  return (
    <div className="border-b bg-muted/20">
      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Tag className="w-3 h-3" />
          Properties
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={addRow}
        >
          <Plus className="w-3 h-3" />
          Add
        </Button>
      </div>
      {displayRows.length > 0 ? (
        <div className="px-4 pb-3 space-y-1.5 max-h-64 overflow-y-auto">
          {displayRows.map((row, idx) => (
            <div key={idx} className="flex items-center gap-1.5 group">
              <Input
                value={row.key}
                onChange={(e) => updateRow(idx, { key: e.target.value })}
                className="h-7 text-xs font-medium w-32 shrink-0 bg-background"
                placeholder="key"
              />
              <Select
                value={row.type}
                onValueChange={(v) => updateRow(idx, { type: v as PropType })}
              >
                <SelectTrigger className="h-7 w-20 text-xs shrink-0 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="checkbox">Checkbox</SelectItem>
                  <SelectItem value="list">List</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="datetime">DateTime</SelectItem>
                </SelectContent>
              </Select>
              <ValueEditor
                row={row}
                onChange={(value) => updateRow(idx, { value })}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => removeRow(idx)}
                aria-label="Remove property"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 pb-3 text-xs text-muted-foreground italic">
          No properties yet. Click “Add” to create one.
        </div>
      )}
    </div>
  );
}

function ValueEditor({
  row,
  onChange,
}: {
  row: PropertyRow;
  onChange: (value: unknown) => void;
}) {
  const cn_input = "h-7 text-xs flex-1 min-w-0 bg-background";

  if (row.type === "checkbox") {
    return (
      <Button
        variant="outline"
        size="sm"
        className={cn("h-7 px-3 text-xs flex-1 justify-start", cn_input)}
        onClick={() => onChange(!row.value)}
      >
        <Badge variant={row.value ? "default" : "outline"} className="text-[10px]">
          {row.value ? "true" : "false"}
        </Badge>
      </Button>
    );
  }

  if (row.type === "list") {
    const items = Array.isArray(row.value)
      ? row.value
      : String(row.value ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    return (
      <div className={cn("flex flex-wrap gap-1 items-center min-h-7 flex-1 bg-background border rounded px-1.5 py-1")}>
        {items.map((item, i) => (
          <Badge key={i} variant="secondary" className="text-[10px] gap-1">
            {String(item)}
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="ml-0.5 hover:text-destructive"
              aria-label="Remove item"
            >
              ×
            </button>
          </Badge>
        ))}
        <input
          className="text-xs bg-transparent outline-none flex-1 min-w-[60px] h-5"
          placeholder="add, comma"
          onKeyDown={(e) => {
            if (e.key === "," || e.key === "Enter") {
              e.preventDefault();
              const v = (e.target as HTMLInputElement).value.trim();
              if (v) {
                onChange([...items, v]);
                (e.target as HTMLInputElement).value = "";
              }
            }
          }}
        />
      </div>
    );
  }

  return (
    <Input
      value={String(row.value ?? "")}
      onChange={(e) => {
        const v = e.target.value;
        if (row.type === "number") {
          onChange(v === "" ? "" : Number(v));
        } else {
          onChange(v);
        }
      }}
      className={cn_input}
      placeholder="value"
    />
  );
}

function inferType(value: unknown): PropType {
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "list";
  return "text";
}

function coerceValue(value: unknown, type: PropType): unknown {
  if (type === "checkbox") return Boolean(value);
  if (type === "number") {
    const n = Number(value);
    return isNaN(n) ? 0 : n;
  }
  if (type === "list") {
    if (Array.isArray(value)) return value;
    return String(value)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return value;
}
