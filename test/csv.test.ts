import { describe, expect, test } from "vitest";
import { CsvParseError, csvField, parseCsv, parseCsvRecords, stringifyCsv } from "../src/csv.ts";

describe("parseCsv (RFC 4180)", () => {
  test("plain fields, CRLF and LF, trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a,b\r1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("quoted fields with delimiters, doubled quotes and newlines", () => {
    expect(parseCsv('"a,b","say ""hi""","line1\r\nline2"\n')).toEqual([
      ["a,b", 'say "hi"', "line1\r\nline2"],
    ]);
  });

  test("empty fields, empty quoted field at end of line, BOM, custom delimiter", () => {
    expect(parseCsv("a,,c\n,,\n")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
    expect(parseCsv('a,""\n')).toEqual([["a", ""]]);
    expect(parseCsv("﻿x;y\n1;2", { delimiter: ";" })).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
    expect(parseCsv("")).toEqual([]);
  });

  test("an unterminated quote throws", () => {
    expect(() => parseCsv('a,"b\n')).toThrow(CsvParseError);
  });

  test("records: header-keyed, skips blank lines, pads short rows", () => {
    expect(parseCsvRecords(" url , slug\n\nhttps://a.com\n")).toEqual({
      headers: ["url", "slug"],
      records: [{ url: "https://a.com", slug: "" }],
    });
    expect(parseCsvRecords("")).toEqual({ headers: [], records: [] });
  });
});

describe("stringifyCsv", () => {
  test("quotes only when needed and round-trips", () => {
    const rows = [
      ["id", "text", "n", "b", "none"],
      ["1", 'he said "x", then\nleft', 3, true, null],
      ["2", " padded ", 0, false, undefined],
    ];
    const csv = stringifyCsv(rows);
    expect(csv.split("\r\n")[0]).toBe("id,text,n,b,none");
    expect(csvField('a"b')).toBe('"a""b"');
    expect(csvField("plain")).toBe("plain");
    expect(parseCsv(csv)).toEqual(
      rows.map((r) => r.map((v) => (v === null || v === undefined ? "" : String(v)))),
    );
  });
});
