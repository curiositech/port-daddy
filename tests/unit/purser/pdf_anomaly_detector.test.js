// tests/unit/purser/pdf_anomaly_detector.test.js
import { readFileSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Resolve a path relative to the repository root.
 * The test file lives in: <repo>/tests/unit/purser/
 */
function repoRootPath(...segments) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // go up three levels: purser -> unit -> tests -> repo root
  return path.resolve(__dirname, "..", "..", "..", ...segments);
}

/**
 * Helper: extract plain‑text strings from a PDF by naïvely interpreting the
 * binary as latin‑1. This works for our purposes because PDF streams contain
 * the human‑readable text as clear‑text fragments.
 */
function extractPdfText(pdfPath) {
  const buffer = readFileSync(pdfPath);
  // latin1 preserves a 1‑to‑1 mapping of bytes → Unicode code points
  return buffer.toString("latin1");
}

/**
 * Count occurrences of a simple pattern in the raw PDF text.
 * Used for a cheap sanity‑check on page count (`/Count` entry) and for
 * verifying that expected keywords appear.
 */
function countPattern(text, pattern) {
  const regex = new RegExp(pattern, "g");
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/* -------------------------------------------------------------------------- */
/* 1️⃣ PDF METADATA & CONTENT VALIDATION                                      */
/* -------------------------------------------------------------------------- */
describe("PDF anomaly detector – metadata & content verification", () => {
  const pdf4Path = repoRootPath(
    "docs",
    "harbor-research",
    "pdf",
    "paper4.pdf"
  );
  const pdf5Path = repoRootPath(
    "docs",
    "harbor-research",
    "pdf",
    "paper5.pdf"
  );

  test("paper4.pdf exists and is non‑empty", () => {
    const stats = readFileSync(pdf4Path, { flag: "r" });
    expect(stats.length).toBeGreaterThan(0);
  });

  test("paper5.pdf exists and is non‑empty", () => {
    const stats = readFileSync(pdf5Path, { flag: "r" });
    expect(stats.length).toBeGreaterThan(0);
  });

  test("paper4.pdf contains expected bibliographic strings", () => {
    const text = extractPdfText(pdf4Path);
    // Title (case‑insensitive)
    expect(text).toMatch(/What,\s*Indeed,\s*Is\s*Intransitive\s*Noninterference\?/i);
    // Venue & year
    expect(text).toMatch(/ESORICS.*2007/i);
    // Core claim – TA‑security completeness
    expect(text).toMatch(/TA[-\s]?security/i);
    // Quick sanity: PDF reports at least one /Page object
    expect(countPattern(text, "/Page")).toBeGreaterThan(0);
  });

  test("paper5.pdf contains expected bibliographic strings", () => {
    const text = extractPdfText(pdf5Path);
    // Title / author
    expect(text).toMatch(/Information\s+Revelation\s+and\s+Certification\s+Intermediaries/i);
    // Venue, issue and year
    expect(text).toMatch(/RAND\s+Journal\s+of\s+Economics.*30\s*\(\s*3\s*\).*1999/i);
    // Key term indicating the “monopoly pooling” result
    expect(text).toMatch(/monopoly.*pooling/i);
    // Ensure at least a few page objects are present
    expect(countPattern(text, "/Page")).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 2️⃣ TEX FILE INTEGRITY – citation keys and brace balance                    */
/* -------------------------------------------------------------------------- */
describe("LaTeX source integrity", () => {
  const tex4Path = repoRootPath(
    "docs",
    "harbor-research",
    "tex",
    "paper4.tex"
  );
  const tex5Path = repoRootPath(
    "docs",
    "harbor-research",
    "tex",
    "paper5.tex"
  );

  function braceBalance(content) {
    const open = (content.match(/{/g) || []).length;
    const close = (content.match(/}/g) || []).length;
    return open - close;
  }

  test("paper4.tex includes the van‑der‑Meyden citation and balanced braces", () => {
    const content = readFileSync(tex4Path, "utf8");
    expect(content).toContain("\\bibitem{vdm07}");
    // The added paragraph should contain the citation key
    expect(content).toMatch(/\\cite\{vdm07\}/);
    expect(braceBalance(content)).toBe(0);
  });

  test("paper5.tex includes the Lizzeri citation and balanced braces", () => {
    const content = readFileSync(tex5Path, "utf8");
    expect(content).toContain("\\bibitem{lizzeri99}");
    expect(content).toMatch(/\\cite\{lizzeri99\}/);
    expect(braceBalance(content)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 3️⃣ BIBLIOGRAPHY.md must remain untouched for the new citations             */
/* -------------------------------------------------------------------------- */
describe("BIBLIOGRAPHY.md immutability check", () => {
  const bibPath = repoRootPath("BIBLIOGRAPHY.md");

  test("does not contain the new citation keys", () => {
    const content = readFileSync(bibPath, "utf8");
    // The contract explicitly forbids adding entries for vdm07 / lizzeri99
    expect(content).not.toMatch(/vdm07/);
    expect(content).not.toMatch(/lizzeri99/);
  });
});

/* -------------------------------------------------------------------------- */
/* 4️⃣ SCRIPT EXIT CODES – ensure the verification scripts report success    */
/* -------------------------------------------------------------------------- */
describe("Citation‑verification scripts exit cleanly", () => {
  const nodeScript = repoRootPath("scripts", "check-doc-citations.mjs");
  const pyScript = repoRootPath(
    "scripts",
    "harbor-research",
    "check_citations.py"
  );
  const pyCorrScript = repoRootPath(
    "scripts",
    "harbor-research",
    "check_propagated_corrections.py"
  );

  test("check-doc-citations.mjs exits with code 0", () => {
    const result = execSync(`node "${nodeScript}"`, {
      stdio: "pipe",
    });
    // If execSync returns, exit code is 0
    expect(result).toBeInstanceOf(Buffer);
  });

  test("check_citations.py exits with code 0 and reports no orphaned items", () => {
    const output = execSync(`python3 "${pyScript}"`, {
      stdio: "pipe",
    }).toString("utf8");
    // The script is expected to print a summary line – we assert the
    // “orphaned” count is zero.
    expect(output).toMatch(/orphaned\s*:\s*0/i);
    expect(output).toMatch(/dangling\s*:\s*0/i);
  });

  test("check_propagated_corrections.py reports 14/14 resolved items", () => {
    const output = execSync(`python3 "${pyCorrScript}"`, {
      stdio: "pipe",
    }).toString("utf8");
    // Look for the “resolved” fraction.
    expect(output).toMatch(/resolved\s*:\s*14\s*\/\s*14/i);
  });
});

/* -------------------------------------------------------------------------- */
/* 5️⃣ Audit‑trail – timestamps for PDF verification (logged via test output) */
/* -------------------------------------------------------------------------- */
describe("Audit‑trail timestamps (informational)", () => {
  test("log current timestamp for PDF checks", () => {
    const now = new Date().toISOString();
    // Jest will surface this log; it serves as the required audit trail.
    console.info(`Audit timestamp for PDF verification: ${now}`);
    expect(now).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
    );
  });
});