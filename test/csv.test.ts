import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/ingest/csv.js";

test("parses headers and rows with aliased columns", () => {
  const csv = "Email,Full Name,Organization\na@b.cz,Ada Lovelace,Analytical Engines\n";
  const [lead] = parseCsv(csv);
  assert.equal(lead!.email, "a@b.cz");
  assert.equal(lead!.name, "Ada Lovelace");
  assert.equal(lead!.company, "Analytical Engines");
  assert.match(lead!.id, /^[0-9a-f]{12}$/);
});

test("handles quoted commas", () => {
  const csv = 'email,notes\nx@y.cz,"big lead, met at conference"\n';
  const [lead] = parseCsv(csv);
  assert.equal(lead!.notes, "big lead, met at conference");
});

test("skips rows without a valid email", () => {
  const csv = "email,name\nnot-an-email,Ghost\nreal@deal.cz,Real\n";
  const leads = parseCsv(csv);
  assert.equal(leads.length, 1);
  assert.equal(leads[0]!.email, "real@deal.cz");
});

test("throws when no email column exists", () => {
  assert.throws(() => parseCsv("name,company\nAda,Engines\n"));
});
