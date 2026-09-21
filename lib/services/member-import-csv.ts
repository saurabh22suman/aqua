import { normaliseToE164 } from "@/lib/phone";

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
};

// RFC 4180-ish: quoted fields may contain commas, newlines and
// doubled quotes. Returns raw rows with their 1-based file line
// numbers so every error can name the row the operator sees.
export function parseCsv(text: string): {
  rows: Array<{ rowNumber: number; values: string[] }>;
} {
  const rows: Array<{ rowNumber: number; values: string[] }> = [];
  let values: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let started = false;

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
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      started = true;
    } else if (char === ",") {
      pushField();
      started = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      if (started || field.length > 0 || values.length > 0) pushRow();
      line += 1;
      rowStartLine = line;
      started = false;
    } else {
      field += char;
      started = true;
    }
  }
  if (started || field.length > 0 || values.length > 0) pushRow();

  return { rows };
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

// Accepts ISO dates, and DD/MM/YYYY only when the day is > 12 (the
// Indian convention, unambiguous). 03/04/2026 is rejected with an
// explicit "ambiguous" reason rather than guessed at.
export function parseImportDate(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const text = raw.trim();
  const iso = text.match(ISO_DATE);
  if (iso) {
    const [, y, m, d] = iso;
    if (isRealCalendarDate(Number(y), Number(m), Number(d))) {
      return { ok: true, value: text };
    }
    return { ok: false, reason: "That date does not exist." };
  }
  const dmy = text.match(DMY_DATE);
  if (dmy) {
    const [, d, m, y] = dmy;
    if (Number(d) <= 12) {
      return {
        ok: false,
        reason: "Ambiguous date — write it as YYYY-MM-DD.",
      };
    }
    if (!isRealCalendarDate(Number(y), Number(m), Number(d))) {
      return { ok: false, reason: "That date does not exist." };
    }
    return {
      ok: true,
      value: `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`,
    };
  }
  return { ok: false, reason: "Use a YYYY-MM-DD date." };
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
  const { rows } = parseCsv(text);
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
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
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
