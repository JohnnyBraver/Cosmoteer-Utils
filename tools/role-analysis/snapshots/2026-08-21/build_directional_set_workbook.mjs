import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import process from "node:process";
import { pathToFileURL } from "node:url";

const LOCAL_BASE = process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local");
const LOCAL_ROOT = path.resolve(process.env.COSMOTEER_UTILS_HOME || path.join(LOCAL_BASE, "Cosmoteer-Utils"));
const options = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (!["--data", "--output", "--artifact-module"].includes(key) || !process.argv[i + 1]) {
    throw new Error("Usage: node build_directional_set_workbook.mjs [--data JSON] [--output XLSX] [--artifact-module MODULE]");
  }
  options.set(key, process.argv[++i]);
}
const artifactModulePath = options.get("--artifact-module") ?? process.env.OAI_ARTIFACT_TOOL_MODULE;
const artifactModule = artifactModulePath
  ? pathToFileURL(path.resolve(artifactModulePath)).href
  : "@oai/artifact-tool";
const { Workbook, SpreadsheetFile } = await import(artifactModule);
const dataPath = path.resolve(options.get("--data") ?? path.join(LOCAL_ROOT, "analysis", "directional_set_comparison.json"));
const outputPath = path.resolve(options.get("--output") ?? path.join(LOCAL_ROOT, "reports", "workbooks", "Cosmoteer_Role_Family_Comparisons.xlsx"));
const outDir = path.dirname(outputPath);
const data = JSON.parse(await fs.readFile(dataPath, "utf8"));
await fs.mkdir(outDir, { recursive: true });

const wb = Workbook.create();
const overview = wb.worksheets.add("Overview");
const directory = wb.worksheets.add("Set Directory");
const combat = wb.worksheets.add("Combat Sets");
const civilian = wb.worksheets.add("Civilian Sets");
const corrections = wb.worksheets.add("Corrections");
const donorReview = wb.worksheets.add("Donor Review");
const versions = wb.worksheets.add("Role Versions");
const transitions = wb.worksheets.add("Variant Transitions");
const exceptions = wb.worksheets.add("Exceptions");
const exactAudit = wb.worksheets.add("Exact Audit");
const internalAudit = wb.worksheets.add("Internal Audit");
const priorityMap = wb.worksheets.add("Priority Map");
const excludedSets = wb.worksheets.add("Excluded Sets");
const excluded = wb.worksheets.add("Excluded Profiles");

const colors = {
  navy: "#0F172A", teal: "#0F766E", tealLight: "#CCFBF1", slate: "#475569",
  light: "#F8FAFC", border: "#CBD5E1", blue: "#DBEAFE", blueText: "#1E40AF",
  orange: "#FFEDD5", orangeText: "#9A3412", gray: "#E5E7EB", grayText: "#374151",
  charcoal: "#374151", lavender: "#EDE9FE", lavenderText: "#5B21B6",
  white: "#FFFFFF", yellow: "#FEF3C7", yellowText: "#92400E",
};
const titleFmt = { fill: colors.navy, font: { bold: true, color: colors.white, size: 16 }, verticalAlignment: "center" };
const headerFmt = { fill: colors.teal, font: { bold: true, color: colors.white }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
const noteFmt = { fill: colors.tealLight, font: { color: "#134E4A" }, wrapText: true, verticalAlignment: "top" };

function colName(n) {
  let s = "";
  while (n) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function setWidths(sheet, widths) {
  for (const [index, width] of widths.entries()) {
    sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidth = width;
  }
}
function writeMatrix(sheet, rowIndex, colIndex, matrix, chunk = 1500) {
  if (!matrix.length) return;
  for (let i = 0; i < matrix.length; i += chunk) {
    const part = matrix.slice(i, i + chunk);
    sheet.getRangeByIndexes(rowIndex + i, colIndex, part.length, part[0].length).values = part;
  }
}
function addTable(sheet, startRow, rowCount, colCount, name, style = "TableStyleMedium2") {
  if (rowCount < 2) return null;
  const endRow = startRow + rowCount - 1;
  const table = sheet.tables.add("A" + startRow + ":" + colName(colCount) + endRow, true, name);
  table.style = style;
  table.showFilterButton = true;
  table.showBandedRows = true;
  return table;
}
function addDirectionFormats(range) {
  range.conditionalFormats.add("containsText", { text: "HIGHER", format: { fill: colors.blue, font: { color: colors.blueText } } });
  range.conditionalFormats.add("containsText", { text: "LOWER", format: { fill: colors.orange, font: { color: colors.orangeText } } });
  range.conditionalFormats.add("containsText", { text: "MATCH", format: { fill: colors.gray, font: { color: colors.grayText } } });
  range.conditionalFormats.add("containsText", { text: "OFF", format: { fill: colors.charcoal, font: { color: colors.white, bold: true } } });
  range.conditionalFormats.add("containsText", { text: "VARIED", format: { fill: colors.lavender, font: { color: colors.lavenderText, bold: true } } });
}
function addStateFormats(range) {
  range.conditionalFormats.add("containsText", { text: "CONFIRMED CHANGE", format: { fill: colors.blue, font: { color: colors.blueText, bold: true } } });
  range.conditionalFormats.add("containsText", { text: "CONFIRMED KEEP", format: { fill: colors.tealLight, font: { color: "#134E4A", bold: true } } });
  range.conditionalFormats.add("containsText", { text: "DONOR REVIEW", format: { fill: colors.lavender, font: { color: colors.lavenderText, bold: true } } });
  range.conditionalFormats.add("containsText", { text: "RETAINED", format: { fill: colors.tealLight, font: { color: "#134E4A", bold: true } } });
  range.conditionalFormats.add("containsText", { text: "REJECTED", format: { fill: colors.gray, font: { color: colors.grayText } } });
  range.conditionalFormats.add("containsText", { text: "INACTIVE", format: { fill: colors.gray, font: { color: colors.grayText } } });
}
function addSheetTitle(sheet, title, note, lastCol) {
  sheet.showGridLines = false;
  sheet.getRange("A1:" + lastCol + "1").merge();
  sheet.getRange("A1").values = [[title]];
  sheet.getRange("A1:" + lastCol + "1").format = titleFmt;
  sheet.getRange("A1:" + lastCol + "1").format.rowHeight = 30;
  sheet.getRange("A2:" + lastCol + "2").merge();
  sheet.getRange("A2").values = [[note]];
  sheet.getRange("A2:" + lastCol + "2").format = noteFmt;
  sheet.getRange("A2:" + lastCol + "2").format.rowHeight = 36;
}
function applyHeader(sheet, row, colCount) {
  const range = sheet.getRange("A" + row + ":" + colName(colCount) + row);
  range.format = headerFmt;
  range.format.rowHeight = 38;
}
function toDate(value) {
  return value ? new Date(value) : null;
}

// Exact audit source table. Set Directory formulas reference this bounded range.
const auditHeaders = [
  "candidate_id", "profile_hash", "context", "baseline_role", "target_role",
  "ui_category", "ui_action", "part_name", "part_id", "component_id",
  "builtin_default", "baseline_value", "target_value", "baseline_source",
  "target_source", "direction", "delta", "default_source", "resolution", "source_file",
];
const auditRows = data.visible_exact.map(row => auditHeaders.map(header => row[header] ?? ""));
exactAudit.showGridLines = false;
exactAudit.getRange("A1:T1").values = [auditHeaders];
exactAudit.getRange("A1:T1").format = headerFmt;
writeMatrix(exactAudit, 1, 0, auditRows);
addTable(exactAudit, 1, auditRows.length + 1, auditHeaders.length, "DirectionalExactAudit");
setWidths(exactAudit, [18, 20, 14, 24, 24, 22, 28, 32, 38, 28, 14, 14, 14, 20, 20, 15, 10, 38, 20, 65]);
exactAudit.freezePanes.freezeRows(1);
exactAudit.freezePanes.freezeColumns(5);
addDirectionFormats(exactAudit.getRange("P2:P" + (auditRows.length + 1)));
exactAudit.getRange("K2:Q" + (auditRows.length + 1)).format.verticalAlignment = "top";

const internalRows = data.internal_exact.map(row => auditHeaders.map(header => row[header] ?? ""));
internalAudit.showGridLines = false;
internalAudit.getRange("A1:T1").values = [auditHeaders];
internalAudit.getRange("A1:T1").format = headerFmt;
writeMatrix(internalAudit, 1, 0, internalRows);
addTable(internalAudit, 1, internalRows.length + 1, auditHeaders.length, "DirectionalInternalAudit");
setWidths(internalAudit, [18, 20, 14, 24, 24, 22, 28, 32, 38, 28, 14, 14, 14, 20, 20, 15, 10, 38, 20, 65]);
internalAudit.freezePanes.freezeRows(1);
internalAudit.freezePanes.freezeColumns(5);
addDirectionFormats(internalAudit.getRange("P2:P" + (internalRows.length + 1)));

// Set Directory: one provisional candidate plus formula-driven directional counts.
const dirHeaders = [
  "candidate_id", "decision", "active_status", "profile_hash", "ship_count",
  "oldest_modified", "newest_modified", "representative_ship", "example_ships", "role_fingerprint",
  "combat_higher", "combat_lower", "combat_off", "combat_match",
  "civilian_higher", "civilian_lower", "civilian_off", "civilian_match",
];
addSheetTitle(directory, "Provisional Active Crew Set", "Only the surviving complete profile is active. Extracted values remain unchanged; confirmed corrections and donor settings are reviewed on separate sheets.", "R");
directory.getRange("A4:R4").values = [dirHeaders];
applyHeader(directory, 4, dirHeaders.length);
const dirValues = data.candidates.map(row => [
  row.candidate_id, row.decision, row.active_status, row.profile_hash, row.ship_count,
  toDate(row.oldest_modified_utc), toDate(row.newest_modified_utc), row.representative_ship,
  row.example_ships, row.role_fingerprint, "", "", "", "", "", "", "", "",
]);
writeMatrix(directory, 4, 0, dirValues);
const dirLast = data.candidates.length + 4;
const auditLast = auditRows.length + 1;
for (let index = 0; index < data.candidates.length; index++) {
  const row = index + 5;
  const directions = [
    ["COMBAT", "HIGHER"], ["COMBAT", "LOWER"], ["COMBAT", "OFF"], ["COMBAT", "MATCH"],
    ["CIVILIAN", "HIGHER"], ["CIVILIAN", "LOWER"], ["CIVILIAN", "OFF"], ["CIVILIAN", "MATCH"],
  ];
  const formulas = directions.map(([context, result]) =>
    "=COUNTIFS('Exact Audit'!$A$2:$A$" + auditLast + ",$A" + row +
    ",'Exact Audit'!$C$2:$C$" + auditLast + ",\"" + context +
    "\",'Exact Audit'!$P$2:$P$" + auditLast + ",\"" + result + "\")"
  );
  directory.getRange("K" + row + ":R" + row).formulas = [formulas];
}
addTable(directory, 4, data.candidates.length + 1, dirHeaders.length, "ActiveSetDirectory");
setWidths(directory, [18, 14, 22, 20, 12, 18, 18, 32, 62, 74, 14, 14, 12, 14, 15, 15, 13, 15]);
directory.getRange("F5:G" + dirLast).format.numberFormat = "yyyy-mm-dd";
directory.getRange("I5:J" + dirLast).format.wrapText = true;
directory.getRange("A5:R" + dirLast).format.verticalAlignment = "top";
directory.getRange("A5:R" + dirLast).format.rowHeight = 48;
directory.getRange("B5:B" + dirLast).dataValidation = { rule: { type: "list", values: ["Review", "Shortlist", "Chosen", "Reject"] } };
directory.getRange("B5:C" + dirLast).conditionalFormats.add("containsText", { text: "Shortlist", format: { fill: colors.tealLight, font: { color: "#134E4A", bold: true } } });
directory.getRange("B5:C" + dirLast).conditionalFormats.add("containsText", { text: "PROVISIONAL", format: { fill: colors.yellow, font: { color: colors.yellowText, bold: true } } });
const dirSummaryStart = dirLast + 2;
directory.getRange("A" + dirSummaryStart + ":B" + (dirSummaryStart + 3)).values = [
  ["Active candidates", ""], ["Directory status", ""], ["Confirmed changes", ""],
  ["Ship-write status", "READ-ONLY: no ship files modified"],
];
directory.getRange("B" + dirSummaryStart).formulas = [["=COUNTA(A5:A" + dirLast + ")"]];
directory.getRange("B" + (dirSummaryStart + 1)).formulas = [["=IF(AND(B5=\"Shortlist\",C5=\"PROVISIONAL WINNER\"),\"PROVISIONAL - CORRECTIONS PENDING\",\"REVIEW\")"]];
directory.getRange("B" + (dirSummaryStart + 2)).formulas = [["=COUNTIF('Corrections'!$P$5:$P$13,\"CONFIRMED CHANGE\")"]];
directory.getRange("A" + dirSummaryStart + ":A" + (dirSummaryStart + 3)).format = { fill: colors.slate, font: { bold: true, color: colors.white } };
directory.getRange("B" + dirSummaryStart + ":B" + (dirSummaryStart + 3)).format = noteFmt;
directory.freezePanes.freezeRows(4);
directory.freezePanes.freezeColumns(4);

function writeComparisonSheet(sheet, title, note, rows, tableName) {
  const candidateIds = data.candidates.map(candidate => candidate.candidate_id);
  const headers = ["target_role", "ui_category", "ui_action", "parts", ...candidateIds];
  const lastCol = colName(headers.length);
  addSheetTitle(sheet, title, note, lastCol);
  sheet.getRange("A4:" + lastCol + "4").values = [headers];
  applyHeader(sheet, 4, headers.length);
  const values = rows.map(row => [
    row.target_role, row.ui_category, row.ui_action, row.parts,
    ...candidateIds.map(candidateId => row.cells[candidateId]),
  ]);
  writeMatrix(sheet, 4, 0, values, 600);
  const lastRow = values.length + 4;
  addTable(sheet, 4, values.length + 1, headers.length, tableName);
  setWidths(sheet, [24, 22, 28, 48, ...candidateIds.map(() => 29)]);
  sheet.getRange("D5:" + lastCol + lastRow).format.wrapText = true;
  sheet.getRange("A5:" + lastCol + lastRow).format.verticalAlignment = "top";
  sheet.getRange("A5:" + lastCol + lastRow).format.rowHeight = 42;
  for (let index = 0; index < rows.length; index++) {
    const lineCount = Math.max(
      1,
      ...candidateIds.map(candidateId => String(rows[index].cells[candidateId] || "").split("\n").length),
    );
    if (lineCount > 1) {
      const height = Math.min(150, 24 + lineCount * 15);
      sheet.getRangeByIndexes(index + 4, 0, 1, headers.length).format.rowHeight = height;
    }
  }
  const resultRange = sheet.getRange("E5:" + lastCol + lastRow);
  addDirectionFormats(resultRange);
  sheet.freezePanes.freezeRows(4);
  sheet.freezePanes.freezeColumns(4);
  return { lastRow, lastCol };
}

const combatInfo = writeComparisonSheet(
  combat,
  "Combat Crew-Set Comparison",
  "Each candidate column compares its own Unasigned baseline to Engine(r), Operator, both Defenders, Loader, and Distributor. HIGHER/LOWER describe direction only.",
  data.combat_matrix,
  "CombatSetMatrix",
);
const civilianInfo = writeComparisonSheet(
  civilian,
  "Civilian / Cargo Crew-Set Comparison",
  "Each candidate column compares its own Astrophobic Cargo Crew baseline to Engine(r), Operator, and Distributor.",
  data.civilian_matrix,
  "CivilianSetMatrix",
);

// Confirmed corrections remain separate from extracted values.
const correctionHeaders = [
  "candidate_id", "role_name", "retained_variant", "ui_category", "ui_action", "part_name",
  "part_id", "component_id", "builtin_default", "baseline_value", "baseline_source", "source_status",
  "retained_value", "proposed_value", "proposed_direction", "decision_state", "inferred_new_part_coverage", "family_rule",
];
addSheetTitle(corrections, "Confirmed Corrections and Coverage Checks", "Actual extracted values are preserved in Exact Audit. Proposed values apply family rules to uncovered newer parts; CONFIRMED KEEP documents reviewed fallbacks that remain unchanged.", "R");
corrections.getRange("A4:R4").values = [correctionHeaders];
applyHeader(corrections, 4, correctionHeaders.length);
const correctionValues = data.proposed_corrections.map(row => correctionHeaders.map(header => row[header] ?? ""));
writeMatrix(corrections, 4, 0, correctionValues);
const correctionLast = correctionValues.length + 4;
addTable(corrections, 4, correctionValues.length + 1, correctionHeaders.length, "ConfirmedRoleCorrections", "TableStyleMedium4");
setWidths(corrections, [18, 20, 18, 20, 28, 32, 40, 28, 14, 14, 18, 16, 14, 14, 18, 20, 62, 62]);
corrections.getRange("F5:H" + correctionLast).format.wrapText = true;
corrections.getRange("Q5:R" + correctionLast).format.wrapText = true;
corrections.getRange("A5:R" + correctionLast).format.verticalAlignment = "top";
corrections.getRange("A5:R" + correctionLast).format.rowHeight = 58;
addDirectionFormats(corrections.getRange("O5:O" + correctionLast));
addStateFormats(corrections.getRange("P5:P" + correctionLast));
corrections.freezePanes.freezeRows(4);
corrections.freezePanes.freezeColumns(6);

const donorHeaders = [
  "role_name", "source_variant", "retained_variant", "ui_category", "ui_action", "part_name",
  "part_id", "component_id", "builtin_default", "source_value", "source_status",
  "retained_value", "retained_status", "transition_class", "decision_state", "review_note",
];
addSheetTitle(donorReview, "Unresolved E3 Donor Evidence", "These older explicit Engine(r) values become built-in fallback in E4. They remain targeted review evidence and are not merged automatically.", "P");
donorReview.getRange("A4:P4").values = [donorHeaders];
applyHeader(donorReview, 4, donorHeaders.length);
const donorValues = data.donor_evidence.map(row => [
  ...donorHeaders.slice(0, 15).map(header => row[header] ?? ""),
  "Older E3 explicit value differs from retained E4 fallback; decide from intended engine/utility behavior.",
]);
writeMatrix(donorReview, 4, 0, donorValues);
const donorLast = donorValues.length + 4;
addTable(donorReview, 4, donorValues.length + 1, donorHeaders.length, "EngineDonorReview", "TableStyleMedium4");
setWidths(donorReview, [20, 16, 18, 20, 28, 32, 40, 28, 14, 14, 16, 14, 18, 24, 18, 68]);
donorReview.getRange("F5:H" + donorLast).format.wrapText = true;
donorReview.getRange("P5:P" + donorLast).format.wrapText = true;
donorReview.getRange("A5:P" + donorLast).format.verticalAlignment = "top";
donorReview.getRange("A5:P" + donorLast).format.rowHeight = 54;
addStateFormats(donorReview.getRange("O5:O" + donorLast));
donorReview.freezePanes.freezeRows(4);
donorReview.freezePanes.freezeColumns(6);

// Role Versions: active fingerprint plus full retained/inactive catalog.
addSheetTitle(versions, "Role-Version Inventory", "The provisional set is shown first. All 26 variants remain below with retained, superseded, or inactive-with-set status; inactive Operator and Defender variants are not independently rejected.", "N");
const versionHeaders = ["candidate_id", "active_status", "profile_hash", "ship_count", "newest_modified", ...data.meta.all_roles];
versions.getRange("A4:N4").values = [versionHeaders];
applyHeader(versions, 4, versionHeaders.length);
const versionValues = data.candidates.map(candidate => [candidate.candidate_id, candidate.active_status, candidate.profile_hash, candidate.ship_count, toDate(candidate.newest_modified_utc), ...data.meta.all_roles.map(roleName => candidate.role_versions[roleName])]);
writeMatrix(versions, 4, 0, versionValues);
const versionCandidateLast = versionValues.length + 4;
addTable(versions, 4, versionValues.length + 1, versionHeaders.length, "ActiveRoleFingerprint");
versions.getRange("E5:E" + versionCandidateLast).format.numberFormat = "yyyy-mm-dd";
versions.getRange("A" + (versionCandidateLast + 3) + ":N" + (versionCandidateLast + 3)).merge();
versions.getRange("A" + (versionCandidateLast + 3)).values = [["Complete role-variant inventory"]];
versions.getRange("A" + (versionCandidateLast + 3) + ":N" + (versionCandidateLast + 3)).format = { fill: colors.slate, font: { bold: true, color: colors.white } };
const catalogStart = versionCandidateLast + 5;
const catalogHeaders = ["role_name", "variant_id", "variant_hash", "candidate_count", "ship_count", "first_seen", "last_seen", "assignment_priority", "autofill", "explicit_priority_entries", "status", "status_reason", "candidate_ids"];
versions.getRange("A" + catalogStart + ":M" + catalogStart).values = [catalogHeaders];
applyHeader(versions, catalogStart, catalogHeaders.length);
const catalogValues = data.variant_catalog.map(row => [row.role_name, row.variant_id, row.variant_hash, row.candidate_count, row.ship_count, toDate(row.first_seen), toDate(row.last_seen), row.assignment_priority, row.autofill, row.explicit_priority_entries, row.status, row.status_reason, row.candidate_ids]);
writeMatrix(versions, catalogStart, 0, catalogValues);
addTable(versions, catalogStart, catalogValues.length + 1, catalogHeaders.length, "RoleVariantCatalog", "TableStyleMedium4");
const catalogLast = catalogStart + catalogValues.length;
versions.getRange("F" + (catalogStart + 1) + ":G" + catalogLast).format.numberFormat = "yyyy-mm-dd";
setWidths(versions, [28, 22, 20, 14, 18, 18, 18, 20, 14, 22, 28, 62, 62, 24]);
versions.getRange("L" + (catalogStart + 1) + ":M" + catalogLast).format.wrapText = true;
versions.getRange("A" + (catalogStart + 1) + ":M" + catalogLast).format.verticalAlignment = "top";
addStateFormats(versions.getRange("K" + (catalogStart + 1) + ":K" + catalogLast));
versions.freezePanes.freezeRows(4);
versions.freezePanes.freezeColumns(5);

const transitionHeaders = ["role_name", "source_variant", "retained_variant", "ui_category", "ui_action", "part_name", "part_id", "component_id", "builtin_default", "source_value", "source_status", "retained_value", "retained_status", "transition_class", "value_changed", "interpretation", "decision_state"];
addSheetTitle(transitions, "New-Part-Aware Variant Transitions", "Each row distinguishes genuine explicit changes, new coverage, and potentially lost overrides. Fallback on a later-added part is coverage evidence, not an automatic defect.", "Q");
transitions.getRange("A4:Q4").values = [transitionHeaders];
applyHeader(transitions, 4, transitionHeaders.length);
const transitionValues = data.variant_transitions.map(row => transitionHeaders.map(header => row[header] ?? ""));
writeMatrix(transitions, 4, 0, transitionValues);
const transitionLast = transitionValues.length + 4;
addTable(transitions, 4, transitionValues.length + 1, transitionHeaders.length, "NewPartAwareTransitions", "TableStyleMedium4");
setWidths(transitions, [20, 16, 18, 20, 28, 32, 40, 28, 14, 14, 16, 14, 18, 24, 14, 30, 20]);
transitions.getRange("F5:H" + transitionLast).format.wrapText = true;
transitions.getRange("A5:Q" + transitionLast).format.verticalAlignment = "top";
addStateFormats(transitions.getRange("Q5:Q" + transitionLast));
transitions.freezePanes.freezeRows(4);
transitions.freezePanes.freezeColumns(6);

// Exceptions.
const exceptionHeaders = [
  "candidate_id", "profile_hash", "context", "baseline_role", "target_role",
  "ui_category", "ui_action", "part_name", "part_id", "component_id",
  "baseline_value", "target_value", "direction", "baseline_source",
  "target_source", "builtin_default",
];
addSheetTitle(
  exceptions,
  "Part-Level Exceptions",
  "Only the provisional active set's UI actions with more than one baseline/target/direction pair appear here. These rows explain every VARIED or ranged matrix cell.",
  "P",
);
exceptions.getRange("A4:P4").values = [exceptionHeaders];
applyHeader(exceptions, 4, exceptionHeaders.length);
const exceptionValues = data.exceptions.map(row => exceptionHeaders.map(header => row[header] ?? ""));
writeMatrix(exceptions, 4, 0, exceptionValues);
const exceptionLast = exceptionValues.length + 4;
addTable(exceptions, 4, exceptionValues.length + 1, exceptionHeaders.length, "DirectionalExceptions");
setWidths(exceptions, [18, 20, 14, 24, 24, 22, 28, 34, 40, 28, 14, 14, 16, 20, 20, 14]);
addDirectionFormats(exceptions.getRange("M5:M" + exceptionLast));
exceptions.freezePanes.freezeRows(4);
exceptions.freezePanes.freezeColumns(5);

// Priority map.
const mapHeaders = [
  "ui_category", "ui_action", "part_name", "part_id", "component_id",
  "ui_visibility", "builtin_default", "default_source", "resolution", "source_file",
];
priorityMap.showGridLines = false;
priorityMap.getRange("A1:J1").values = [mapHeaders];
priorityMap.getRange("A1:J1").format = headerFmt;
const mapValues = data.priority_map.map(row => mapHeaders.map(header => row[header] ?? ""));
writeMatrix(priorityMap, 1, 0, mapValues);
addTable(priorityMap, 1, mapValues.length + 1, mapHeaders.length, "InstalledPriorityMap");
setWidths(priorityMap, [22, 30, 34, 42, 30, 28, 16, 42, 22, 72]);
priorityMap.freezePanes.freezeRows(1);

// Excluded complete candidate sets.
const excludedSetHeaders = ["candidate_id", "decision", "active_status", "profile_hash", "ship_count", "oldest_modified", "newest_modified", "representative_ship", "role_fingerprint", "exclusion_reason", "inactive_role_note"];
addSheetTitle(excludedSets, "Excluded Complete Crew Sets", "Thirteen complete profiles were removed from active comparison. Rejection reasons refer only to retained Engine(r), Loader, Distributor, and Astrophobic lineage rules; Operator and Defender variants are not independently condemned.", "K");
excludedSets.getRange("A4:K4").values = [excludedSetHeaders];
applyHeader(excludedSets, 4, excludedSetHeaders.length);
const excludedSetValues = data.pruned_candidates.map(row => [row.candidate_id, row.decision, row.active_status, row.profile_hash, row.ship_count, toDate(row.oldest_modified_utc), toDate(row.newest_modified_utc), row.representative_ship, row.role_fingerprint, row.exclusion_reason, row.inactive_role_note]);
writeMatrix(excludedSets, 4, 0, excludedSetValues);
const excludedSetLast = excludedSetValues.length + 4;
addTable(excludedSets, 4, excludedSetValues.length + 1, excludedSetHeaders.length, "ExcludedCompleteSets", "TableStyleMedium4");
setWidths(excludedSets, [18, 14, 16, 20, 12, 18, 18, 34, 72, 72, 68]);
excludedSets.getRange("F5:G" + excludedSetLast).format.numberFormat = "yyyy-mm-dd";
excludedSets.getRange("H5:K" + excludedSetLast).format.wrapText = true;
excludedSets.getRange("A5:K" + excludedSetLast).format.verticalAlignment = "top";
excludedSets.getRange("A5:K" + excludedSetLast).format.rowHeight = 58;
addStateFormats(excludedSets.getRange("B5:C" + excludedSetLast));
excludedSets.freezePanes.freezeRows(4);
excludedSets.freezePanes.freezeColumns(4);

// Excluded profiles.
const excludedRows = data.profile_audit.filter(row => !row.selectable);
const excludedHeaders = [
  "profile_hash", "exclusion_reason", "ship_count", "oldest_modified_utc",
  "newest_modified_utc", "role_count", "role_names", "example_ships",
];
addSheetTitle(
  excluded,
  "Non-Selectable Profiles",
  "Cargo Crew profiles and incomplete legacy profiles remain available for audit but are not candidates for the complete replacement set.",
  "H",
);
excluded.getRange("A4:H4").values = [excludedHeaders];
applyHeader(excluded, 4, excludedHeaders.length);
const excludedValues = excludedRows.map(row => [
  row.profile_hash, row.exclusion_reason, row.ship_count,
  toDate(row.oldest_modified_utc), toDate(row.newest_modified_utc),
  row.role_count, row.role_names, row.example_ships,
]);
writeMatrix(excluded, 4, 0, excludedValues);
const excludedLast = excludedValues.length + 4;
addTable(excluded, 4, excludedValues.length + 1, excludedHeaders.length, "ExcludedProfileAudit");
setWidths(excluded, [22, 54, 12, 18, 18, 12, 95, 85]);
excluded.getRange("D5:E" + excludedLast).format.numberFormat = "yyyy-mm-dd";
excluded.getRange("B5:H" + excludedLast).format.wrapText = true;
excluded.getRange("A5:H" + excludedLast).format.verticalAlignment = "top";
excluded.getRange("A5:H" + excludedLast).format.rowHeight = 48;
excluded.freezePanes.freezeRows(4);

// Overview.
overview.showGridLines = false;
overview.getRange("A1:H1").merge();
overview.getRange("A1").values = [["Cosmoteer New-Part-Aware Role Pruning"]];
overview.getRange("A1:H1").format = titleFmt;
overview.getRange("A1:H1").format.rowHeight = 32;
overview.getRange("A3:B3").values = [["Metric", "Value"]];
overview.getRange("A3:B3").format = headerFmt;
overview.getRange("A4:A15").values = [["Decoded ships"], ["Source role profiles"], ["Complete source sets"], ["Active provisional sets"], ["Excluded complete sets"], ["Ships represented by complete sets"], ["Non-selectable legacy profiles"], ["Visible UI settings"], ["Distinct role variants"], ["Confirmed changes"], ["Confirmed no-change checks"], ["E3 donor-review keys"]];
overview.getRange("B4:B15").values = [[data.meta.decoded_ship_count], [data.meta.source_profile_count], [data.meta.candidate_profile_count], [data.meta.active_candidate_count], [data.meta.pruned_candidate_count], [data.meta.candidate_ship_count], [data.meta.excluded_profile_count], [data.meta.visible_ui_entries], [data.variant_catalog.length], [data.meta.confirmed_correction_count], [data.meta.confirmed_keep_count], [data.meta.donor_review_count]];
overview.getRange("A4:A15").format = { fill: colors.light, font: { bold: true, color: colors.slate } };
overview.getRange("B4:B15").format = { fill: colors.white, font: { bold: true, color: colors.navy }, numberFormat: "0" };
overview.getRange("D3:H3").merge();
overview.getRange("D3").values = [["Transition classification"]];
overview.getRange("D3:H3").format = headerFmt;
overview.getRange("D4:E7").values = [["EXPLICIT → EXPLICIT", "Genuine role-version change."], ["FALLBACK → EXPLICIT", "New coverage or deliberate specialization."], ["EXPLICIT → FALLBACK", "Potentially lost fix; preserve as donor evidence."], ["FALLBACK → FALLBACK", "No role-serialization change."]];
overview.getRange("D4:D4").format = { fill: colors.blue, font: { bold: true, color: colors.blueText } };
overview.getRange("D5:D5").format = { fill: colors.tealLight, font: { bold: true, color: "#134E4A" } };
overview.getRange("D6:D6").format = { fill: colors.lavender, font: { bold: true, color: colors.lavenderText } };
overview.getRange("D7:D7").format = { fill: colors.gray, font: { bold: true, color: colors.grayText } };
overview.getRange("E4:H7").merge(true);
overview.getRange("E4:H7").format = { wrapText: true, verticalAlignment: "center" };
overview.getRange("D9:H9").merge();
overview.getRange("D9").values = [["Interpretation"]];
overview.getRange("D9:H9").format = { fill: colors.slate, font: { bold: true, color: colors.white } };
overview.getRange("D10:H14").merge();
overview.getRange("D10").values = [["The active profile remains an extracted, read-only source. Confirmed corrections are proposed separately. Older fallback values on newer parts are treated as coverage gaps, while older explicit values lost to fallback remain reviewable donor evidence."]];
overview.getRange("D10:H14").format = noteFmt;
overview.getRange("A17:H17").merge();
overview.getRange("A17").values = [["Read in order: Set Directory → Corrections → Donor Review → Combat/Civilian Sets → Role Versions → Variant Transitions → audits"]];
overview.getRange("A17:H17").format = { fill: colors.navy, font: { bold: true, color: colors.white } };
overview.getRange("A19:B22").values = [["Active candidate", ""], ["Directory status", ""], ["Confirmed changes", ""], ["Ship-write status", "READ-ONLY: no ship files modified"]];
overview.getRange("B19").formulas = [["='Set Directory'!A5"]];
overview.getRange("B20").formulas = [["='Set Directory'!B8"]];
overview.getRange("B21").formulas = [["=COUNTIF('Corrections'!$P$5:$P$13,\"CONFIRMED CHANGE\")"]];
overview.getRange("A19:A22").format = { fill: colors.slate, font: { bold: true, color: colors.white } };
overview.getRange("B19:B22").format = noteFmt;
setWidths(overview, [32, 30, 4, 24, 32, 22, 22, 24]);
overview.freezePanes.freezeRows(3);

await wb.comments.setSelf({ displayName: "Codex" });

// Compact verification.
const inspectDirectory = await wb.inspect({ kind: "table", sheetId: "Set Directory", range: "A1:R12", include: "values,formulas", tableMaxRows: 12, tableMaxCols: 18, maxChars: 22000 });
await fs.writeFile(outDir + "/directional_workbook_inspect_directory.ndjson", inspectDirectory.ndjson, "utf8");
const inspectCombat = await wb.inspect({ kind: "table", sheetId: "Combat Sets", range: "A1:E16", include: "values,formulas", tableMaxRows: 16, tableMaxCols: 5, maxChars: 16000 });
await fs.writeFile(outDir + "/directional_workbook_inspect_combat.ndjson", inspectCombat.ndjson, "utf8");
const inspectCorrections = await wb.inspect({ kind: "table", sheetId: "Corrections", range: "A1:R13", include: "values,formulas", tableMaxRows: 13, tableMaxCols: 18, maxChars: 24000 });
await fs.writeFile(outDir + "/directional_workbook_inspect_corrections.ndjson", inspectCorrections.ndjson, "utf8");
const inspectDonors = await wb.inspect({ kind: "table", sheetId: "Donor Review", range: "A1:P14", include: "values,formulas", tableMaxRows: 14, tableMaxCols: 16, maxChars: 22000 });
await fs.writeFile(outDir + "/directional_workbook_inspect_donors.ndjson", inspectDonors.ndjson, "utf8");
const errors = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 300 }, summary: "new-part-aware role pruning workbook formula error scan" });
await fs.writeFile(outDir + "/directional_workbook_formula_errors.txt", errors.ndjson, "utf8");
const previews = [
  ["Overview", "A1:H23"], ["Set Directory", "A1:R11"], ["Combat Sets", "A1:E24"], ["Civilian Sets", "A1:E24"],
  ["Corrections", "A1:R13"], ["Donor Review", "A1:P14"], ["Role Versions", "A1:N36"], ["Variant Transitions", "A1:Q25"],
  ["Exceptions", "A1:P25"], ["Exact Audit", "A1:T25"], ["Internal Audit", "A1:T25"], ["Priority Map", "A1:J30"],
  ["Excluded Sets", "A1:K18"], ["Excluded Profiles", "A1:H24"],
];
for (const [sheetName, range] of previews) {
  const blob = await wb.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(outDir + "/preview_Directional_" + sheetName.replaceAll(" ", "_") + ".png", new Uint8Array(await blob.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(outputPath);
console.log("Pruned directional workbook exported", outputPath, "sheets", previews.length, "active", data.candidates.length, "excluded", data.pruned_candidates.length, "confirmed changes", data.meta.confirmed_correction_count, "donor reviews", data.meta.donor_review_count, "combat", combatInfo.lastRow, "civilian", civilianInfo.lastRow);
