import { normaliseToE164 } from "@/lib/phone";
import { parseImportDate } from "@/lib/services/member-import-date";
export { parseImportDate } from "@/lib/services/member-import-date";

// PR2-C5 — CSV parsing and row validation for member import. Pure
// functions only: no database, no React. The service
// (lib/services/member-import.ts) adds tenant-aware checks (location
// names, minor/guardian) and the commit path lands in PR2-C6.

export const MEMBER_IMPORT_REQUIRED_COLUMNS = [
  "full_name",
  "date_of_birth",
  "location",
] as const;

export const MEMBER_IMPORT_OPTIONAL_COLUMNS = [
  "phone",
  "guardian_name",
  "guardian_phone",
  "member_code",
] as const;

// Keep a single upload bounded on the pilot's 4 GB VPS. Count source
// records, including blank records, before building per-row objects.
export const MAX_MEMBER_IMPORT_ROWS = 500;
export const MAX_MEMBER_IMPORT_BYTES = 2_000_000;

export function normalizeImportCsv(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").normalize("NFC");
}

export type MemberImportRowError = {
  rowNumber: number;
  field: string;
  reason: string;
};

export type ParsedMemberImportRow = {
  rowNumber: number;
  fullName: string;
  dateOfBirth: string;
  phone: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  memberCode: string | null;
  locationName: string;
};

export type MemberImportParseResult = {
  totalRows: number;
  rows: ParsedMemberImportRow[];
  errors: MemberImportRowError[];
  missingColumns: string[];
  fileError?: string;
};

// RFC 4180-ish: quoted fields may contain commas, newlines and
// doubled quotes. Returns raw rows with their 1-based file line
// numbers so every error can name the row the operator sees.
export function parseCsv(text: string): {
  rows: Array<{ rowNumber: number; values: string[] }>;
  error?: string;
} {
  const rows: Array<{ rowNumber: number; values: string[] }> = [];
  let values: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let started = false;
  let justClosedQuote = false;

  const pushField = () => {
    values.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push({ rowNumber: rowStartLine, values });
    values = [];
    rowStartLine = line;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }
    if (justClosedQuote && char !== "," && char !== "\n" && char !== "\r") {
      return { rows: [], error: `Invalid quote placement on line ${line}.` };
    }
    if (char === '"') {
      if (field.length > 0 || justClosedQuote) {
        return { rows: [], error: `Invalid quote placement on line ${line}.` };
      }
      inQuotes = true;
      started = true;
    } else if (char === ",") {
      pushField();
      started = true;
      justClosedQuote = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      if (started || field.length > 0 || values.length > 0) pushRow();
      line += 1;
      rowStartLine = line;
      started = false;
      justClosedQuote = false;
    } else {
      field += char;
      started = true;
    }
  }
  if (inQuotes) return { rows: [], error: `Unterminated quoted field on line ${rowStartLine}.` };
  if (started || field.length > 0 || values.length > 0) pushRow();

  return { rows };
}

function parseImportPhone(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const cleaned = normaliseToE164(raw.replace(/[\s-]/g, ""));
  if (!/^\+\d{8,15}$/.test(cleaned)) {
    return { ok: false, reason: "Use a phone like +919876543210." };
  }
  return { ok: true, value: cleaned };
}

export function parseMemberImportRows(text: string): MemberImportParseResult {
  if (new TextEncoder().encode(text).length > MAX_MEMBER_IMPORT_BYTES) {
    return { totalRows: 0, rows: [], errors: [], missingColumns: [], fileError: "The file is larger than 2 MB — split it." };
  }
  if (text.includes("\uFFFD") || text.includes("\0")) {
    return { totalRows: 0, rows: [], errors: [], missingColumns: [], fileError: "The file contains invalid text encoding. Export it as UTF-8 CSV." };
  }
  const parsedCsv = parseCsv(normalizeImportCsv(text));
  if (parsedCsv.error) {
    return { totalRows: 0, rows: [], errors: [], missingColumns: [], fileError: parsedCsv.error };
  }
  const { rows } = parsedCsv;
  if (rows.length - 1 > MAX_MEMBER_IMPORT_ROWS) {
    return { totalRows: rows.length - 1, rows: [], errors: [], missingColumns: [], fileError: `Import at most ${MAX_MEMBER_IMPORT_ROWS} rows per file.` };
  }
  const header = rows[0];
  if (!header) {
    return {
      totalRows: 0,
      rows: [],
      errors: [],
      missingColumns: [...MEMBER_IMPORT_REQUIRED_COLUMNS],
    };
  }

  const headerIndex = new Map<string, number>();
  header.values.forEach((value, index) => {
    headerIndex.set(value.trim().toLowerCase(), index);
  });

  const missingColumns = MEMBER_IMPORT_REQUIRED_COLUMNS.filter(
    (column) => !headerIndex.has(column),
  );
  if (missingColumns.length > 0) {
    return { totalRows: rows.length - 1, rows: [], errors: [], missingColumns };
  }

  const cell = (values: string[], column: string): string => {
    const index = headerIndex.get(column);
    return index === undefined ? "" : (values[index] ?? "").trim();
  };

  const parsed: ParsedMemberImportRow[] = [];
  const errors: MemberImportRowError[] = [];

  for (const row of rows.slice(1)) {
    if (row.values.every((value) => value.trim().length === 0)) continue;
    const rowNumber = row.rowNumber;
    let rowFailed = false;

    const fullName = cell(row.values, "full_name");
    if (fullName.length === 0) {
      errors.push({ rowNumber, field: "full_name", reason: "Name is required." });
      rowFailed = true;
    }

    const dobRaw = cell(row.values, "date_of_birth");
    const dob = parseImportDate(dobRaw);
    if (!dob.ok) {
      errors.push({ rowNumber, field: "date_of_birth", reason: dob.reason });
      rowFailed = true;
    }

    const locationName = cell(row.values, "location");
    if (locationName.length === 0) {
      errors.push({ rowNumber, field: "location", reason: "Location is required." });
      rowFailed = true;
    }

    const phoneRaw = cell(row.values, "phone");
    let phone: string | null = null;
    if (phoneRaw.length > 0) {
      const parsedPhone = parseImportPhone(phoneRaw);
      if (parsedPhone.ok) phone = parsedPhone.value;
      else {
        errors.push({ rowNumber, field: "phone", reason: parsedPhone.reason });
        rowFailed = true;
      }
    }

    const guardianPhoneRaw = cell(row.values, "guardian_phone");
    let guardianPhone: string | null = null;
    if (guardianPhoneRaw.length > 0) {
      const parsedPhone = parseImportPhone(guardianPhoneRaw);
      if (parsedPhone.ok) guardianPhone = parsedPhone.value;
      else {
        errors.push({
          rowNumber,
          field: "guardian_phone",
          reason: parsedPhone.reason,
        });
        rowFailed = true;
      }
    }

    if (rowFailed) continue;

    parsed.push({
      rowNumber,
      fullName,
      dateOfBirth: dob.ok ? dob.value : "",
      phone,
      guardianName: cell(row.values, "guardian_name") || null,
      guardianPhone,
      memberCode: cell(row.values, "member_code") || null,
      locationName,
    });
  }

  return {
    totalRows: rows.length - 1,
    rows: parsed,
    errors,
    missingColumns: [],
  };
}

function csvField(value: string): string {
  const safe = /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function memberImportErrorsCsv(errors: MemberImportRowError[]): string {
  const lines = ["row,field,reason"];
  for (const error of errors) {
    lines.push(
      [String(error.rowNumber), error.field, error.reason]
        .map(csvField)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function memberImportTemplateCsv(): string {
  const headers = [
    ...MEMBER_IMPORT_REQUIRED_COLUMNS,
    ...MEMBER_IMPORT_OPTIONAL_COLUMNS,
  ];
  const example = [
    "Asha Rao",
    "2015-04-12",
    "Main",
    "+919876543210",
    "Ravi Rao",
    "+919876543211",
    "",
  ];
  return `${headers.join(",")}\n${example.map(csvField).join(",")}\n`;
}
