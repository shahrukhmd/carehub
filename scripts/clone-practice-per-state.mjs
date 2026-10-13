// Clone a demo practice once per US state: the same setup (sites, providers, payers, templates, workflows,
// fee schedules, rules) and the same demo data (patients, visits, claims, cases, orders, tasks…) with new ids,
// renamed for the state and re-addressed to a city in it. Users are shared: every member of the source
// practice gets a membership in each clone, so the facility switcher lists them all.
//
//   node scripts/clone-practice-per-state.mjs --source riverside --states TX,CA     (a few)
//   node scripts/clone-practice-per-state.mjs --source riverside --states ALL       (every state except the source's)
//   add --dry to print the plan without writing, --remove to delete the clones made by this script.
import { PrismaClient, Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes("--dry");
const REMOVE = args.includes("--remove");
const SOURCE_SLUG = opt("--source", "riverside");
const STATES_ARG = opt("--states", "ALL");

// code, name, demo city, zip, area code — fictional street numbers, real cities.
const STATES = [
  ["AL", "Alabama", "Birmingham", "35203", "205"], ["AK", "Alaska", "Anchorage", "99501", "907"], ["AZ", "Arizona", "Phoenix", "85004", "602"],
  ["AR", "Arkansas", "Little Rock", "72201", "501"], ["CA", "California", "Sacramento", "95814", "916"], ["CO", "Colorado", "Denver", "80202", "303"],
  ["CT", "Connecticut", "Hartford", "06103", "860"], ["DE", "Delaware", "Wilmington", "19801", "302"], ["FL", "Florida", "Tampa", "33602", "813"],
  ["GA", "Georgia", "Atlanta", "30303", "404"], ["HI", "Hawaii", "Honolulu", "96813", "808"], ["ID", "Idaho", "Boise", "83702", "208"],
  ["IL", "Illinois", "Springfield", "62701", "217"], ["IN", "Indiana", "Indianapolis", "46204", "317"], ["IA", "Iowa", "Des Moines", "50309", "515"],
  ["KS", "Kansas", "Topeka", "66603", "785"], ["KY", "Kentucky", "Louisville", "40202", "502"], ["LA", "Louisiana", "Baton Rouge", "70802", "225"],
  ["ME", "Maine", "Portland", "04101", "207"], ["MD", "Maryland", "Baltimore", "21201", "410"], ["MA", "Massachusetts", "Worcester", "01608", "508"],
  ["MI", "Michigan", "Lansing", "48933", "517"], ["MN", "Minnesota", "Saint Paul", "55102", "651"], ["MS", "Mississippi", "Jackson", "39201", "601"],
  ["MO", "Missouri", "Kansas City", "64106", "816"], ["MT", "Montana", "Billings", "59101", "406"], ["NE", "Nebraska", "Omaha", "68102", "402"],
  ["NV", "Nevada", "Reno", "89501", "775"], ["NH", "New Hampshire", "Concord", "03301", "603"], ["NJ", "New Jersey", "Trenton", "08608", "609"],
  ["NM", "New Mexico", "Albuquerque", "87102", "505"], ["NY", "New York", "Albany", "12207", "518"], ["NC", "North Carolina", "Raleigh", "27601", "919"],
  ["ND", "North Dakota", "Fargo", "58102", "701"], ["OH", "Ohio", "Columbus", "43215", "614"], ["OK", "Oklahoma", "Tulsa", "74103", "918"],
  ["OR", "Oregon", "Salem", "97301", "503"], ["PA", "Pennsylvania", "Harrisburg", "17101", "717"], ["RI", "Rhode Island", "Providence", "02903", "401"],
  ["SC", "South Carolina", "Columbia", "29201", "803"], ["SD", "South Dakota", "Sioux Falls", "57104", "605"], ["TN", "Tennessee", "Nashville", "37203", "615"],
  ["TX", "Texas", "Austin", "78701", "512"], ["UT", "Utah", "Salt Lake City", "84111", "801"], ["VT", "Vermont", "Burlington", "05401", "802"],
  ["VA", "Virginia", "Richmond", "23219", "804"], ["WA", "Washington", "Spokane", "99201", "509"], ["WV", "West Virginia", "Charleston", "25301", "304"],
  ["WI", "Wisconsin", "Madison", "53703", "608"], ["WY", "Wyoming", "Cheyenne", "82001", "307"],
];
const FIRST = ["Olivia", "Liam", "Emma", "Noah", "Ava", "Elijah", "Sophia", "Lucas", "Isabella", "Mason", "Mia", "Ethan", "Amelia", "James", "Harper", "Benjamin", "Evelyn", "Henry", "Abigail", "Daniel", "Ella", "Jackson", "Scarlett", "Sebastian", "Grace", "Carter", "Chloe", "Owen", "Lily", "Wyatt"];
const LAST = ["Anderson", "Bennett", "Castillo", "Dawson", "Ellison", "Fletcher", "Garrett", "Holloway", "Ingram", "Jennings", "Keller", "Lawson", "Marsh", "Nolan", "Osborne", "Patel", "Quintero", "Reyes", "Sutton", "Tanaka", "Underwood", "Vargas", "Whitaker", "Xiong", "Yates", "Zimmerman", "Barlow", "Crane", "Donovan", "Everett"];

const dm = Prisma.dmmf.datamodel.models;
const byName = Object.fromEntries(dm.map((m) => [m.name, m]));
const lc = (n) => n[0].toLowerCase() + n.slice(1);
const newId = () => "c" + randomBytes(12).toString("hex").slice(0, 24);
const token = (len) => randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);

// Shared or system tables are never cloned; rows pointing at them keep their values.
const EXTERNAL = new Set(["Organization", "Practice", "User", "Session", "MasterCode", "PayerCatalogEntry", "JobRun"]);
// Logs, imports, tokens and interface traffic stay with the source practice.
const SKIP = new Set(["AuditLog", "MessageLog", "ImportBatch", "ImportMapping", "InterfaceMessage", "ApiClient", "JobRun", "SurveyResponse", "PatientPayment", "ReportSubscription"]);

// Which models take part: everything with practiceId, plus any model that hangs off one of them.
function cloneSet() {
  const set = new Set(dm.filter((m) => !EXTERNAL.has(m.name) && !SKIP.has(m.name) && m.fields.some((f) => f.name === "practiceId")).map((m) => m.name));
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of dm) {
      if (set.has(m.name) || EXTERNAL.has(m.name) || SKIP.has(m.name)) continue;
      const fks = m.fields.filter((f) => f.kind === "object" && f.relationFromFields?.length);
      if (fks.some((f) => set.has(f.type))) { set.add(m.name); grew = true; }
    }
  }
  return set;
}

function fkFields(m) {
  return m.fields.filter((f) => f.kind === "object" && f.relationFromFields?.length).map((f) => {
    const scalar = m.fields.find((x) => x.name === f.relationFromFields[0]);
    return { field: f.relationFromFields[0], target: f.type, required: Boolean(scalar?.isRequired), self: f.type === m.name };
  });
}

// Process order: a model waits for the models its foreign keys point at (inside the clone set, not itself).
function order(set) {
  const done = [];
  const left = new Set(set);
  while (left.size) {
    let picked = null;
    for (const name of left) {
      const deps = fkFields(byName[name]).filter((f) => set.has(f.target) && !f.self).map((f) => f.target);
      if (deps.every((d) => done.includes(d))) { picked = name; break; }
    }
    if (!picked) {
      // A cycle: take the model with the fewest unmet optional links; required unmet links make rows skip.
      let best = null, bestN = 1e9;
      for (const name of left) {
        const n = fkFields(byName[name]).filter((f) => set.has(f.target) && !f.self && !done.includes(f.target)).length;
        if (n < bestN) { best = name; bestN = n; }
      }
      picked = best;
    }
    done.push(picked); left.delete(picked);
  }
  return done;
}

async function loadSource(model, srcPracticeId, idMap, set) {
  const m = byName[model];
  const client = prisma[lc(model)];
  if (m.fields.some((f) => f.name === "practiceId")) return client.findMany({ where: { practiceId: srcPracticeId } });
  // Child table: rows whose parent (any FK into the clone set) belongs to the source practice.
  const or = [];
  for (const fk of fkFields(m)) {
    if (!set.has(fk.target) || fk.self) continue;
    const olds = [...(idMap.get(fk.target)?.keys() ?? [])];
    if (olds.length) or.push({ [fk.field]: { in: olds } });
  }
  if (!or.length) return [];
  return client.findMany({ where: { OR: or } });
}

async function cloneOne(src, st, stateIndex) {
  const [code, name, city, zip, area] = st;
  const practiceName = `${name} Family Practice`;
  const slug = code.toLowerCase();
  const existing = await prisma.practice.findUnique({ where: { slug } });
  if (existing) { console.log(`${code}: practice ${slug} already exists, skipping`); return null; }
  const set = cloneSet();
  const seq = order(set);
  const idMap = new Map(); // model -> Map(oldId -> newId)
  const deferred = []; // [model, newId, field, oldTarget]
  const inserted = []; // [model, rows]
  const stats = {};

  const newPractice = DRY ? { id: "dry" } : await prisma.practice.create({ data: { name: practiceName, slug, state: code, organizationId: src.organizationId } });
  idMap.set("Practice", new Map([[src.id, newPractice.id]]));

  const renameText = (v) => typeof v === "string" ? v.replace(/Riverside Family Practice/g, practiceName).replace(/Riverside/g, name) : v;
  let patientN = 0;

  for (const model of seq) {
    const m = byName[model];
    const rows = await loadSource(model, src.id, idMap, set);
    if (!rows.length) continue;
    const map = new Map();
    idMap.set(model, map);
    const fks = fkFields(m);
    const uniqStr = m.fields.filter((f) => f.isUnique && f.kind === "scalar" && f.type === "String" && f.name !== "id" && !fks.some((k) => k.field === f.name));
    const out = [];
    for (const row of rows) {
      const n = { ...row };
      n.id = newId();
      let skip = false;
      for (const fk of fks) {
        const v = row[fk.field];
        if (v == null) continue;
        if (fk.self) { n[fk.field] = null; deferred.push([model, n.id, fk.field, v]); continue; }
        if (EXTERNAL.has(fk.target)) { if (fk.target === "Practice") n[fk.field] = newPractice.id; continue; }
        if (!set.has(fk.target)) continue;
        const mapped = idMap.get(fk.target)?.get(v);
        if (mapped) n[fk.field] = mapped;
        else if (!idMap.has(fk.target)) { n[fk.field] = null; deferred.push([model, n.id, fk.field, v]); } // target comes later
        else if (fk.required) { skip = true; break; } // parent was skipped
        else n[fk.field] = null;
      }
      if (skip) continue;
      for (const f of uniqStr) if (typeof n[f.name] === "string" && n[f.name]) n[f.name] = token(Math.max(16, Math.min(40, n[f.name].length)));
      if (model === "RenderingProvider") n.userId = null; // one login maps to one provider record
      // Names and addresses for the state.
      for (const f of m.fields) {
        if (f.kind !== "scalar" || f.type !== "String" || typeof n[f.name] !== "string") continue;
        if (["id", "practiceId"].includes(f.name) || fks.some((k) => k.field === f.name)) continue;
        n[f.name] = renameText(n[f.name]);
      }
      if ("state" in n && typeof n.state === "string" && n.state.length === 2 && model !== "Payer") { n.state = code; if ("city" in n) n.city = city; if ("zip" in n) n.zip = zip; }
      if (model === "Patient") {
        const i = patientN++;
        n.firstName = FIRST[(i + stateIndex * 7) % FIRST.length];
        n.lastName = LAST[(i + stateIndex * 11) % LAST.length];
        if (typeof n.phone === "string" && n.phone) n.phone = `(${area}) 555-${String(1000 + ((i * 37 + stateIndex) % 9000)).padStart(4, "0")}`;
        if (typeof n.email === "string" && n.email) n.email = `${n.firstName}.${n.lastName}.${code}@example.com`.toLowerCase();
      }
      if (model === "Location" && typeof n.phone === "string" && n.phone) n.phone = `(${area}) 555-0${100 + out.length}`;
      map.set(row.id, n.id);
      out.push(n);
    }
    stats[model] = out.length;
    inserted.push([model, out]);
    if (!DRY && out.length) {
      for (let i = 0; i < out.length; i += 400) await prisma[lc(model)].createMany({ data: out.slice(i, i + 400) });
    }
  }
  // Ids embedded in text (links such as "/encounters/<id>", JSON id lists on schedules and views, notes) point
  // at the source practice's records; rewrite every old id we know to its clone.
  const all = new Map();
  for (const [, map] of idMap) for (const [o, n] of map) all.set(o, n);
  const idRe = /c[a-z0-9]{24}/g;
  let rewritten = 0;
  for (const [model, rows] of inserted) {
    const m = byName[model];
    const textFields = m.fields.filter((f) => f.kind === "scalar" && f.type === "String" && f.name !== "id" && !fkFields(m).some((k) => k.field === f.name));
    for (const row of rows) {
      const data = {};
      for (const f of textFields) {
        const v = row[f.name];
        if (typeof v !== "string" || !idRe.test(v)) { idRe.lastIndex = 0; continue; }
        idRe.lastIndex = 0;
        const nv = v.replace(idRe, (id) => all.get(id) ?? id);
        if (nv !== v) data[f.name] = nv;
      }
      if (Object.keys(data).length) {
        if (!DRY) await prisma[lc(model)].update({ where: { id: row.id }, data });
        rewritten++;
      }
    }
  }
  // Links that pointed forward or at the same table.
  let fixed = 0;
  for (const [model, id, field, oldTarget] of deferred) {
    const target = fkFields(byName[model]).find((f) => f.field === field)?.target;
    const mapped = idMap.get(target)?.get(oldTarget);
    if (!mapped) continue;
    if (!DRY) await prisma[lc(model)].update({ where: { id }, data: { [field]: mapped } });
    fixed++;
  }
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  console.log(`${code}: ${practiceName} — ${total} rows across ${Object.keys(stats).length} tables, ${fixed} links fixed, ${rewritten} text references rewritten${DRY ? " (dry run)" : ""}`);
  return { practiceId: newPractice.id, stats };
}

async function removeClones(srcState) {
  const slugs = STATES.map((s) => s[0].toLowerCase()).filter((s) => s !== srcState?.toLowerCase());
  const found = await prisma.practice.findMany({ where: { slug: { in: slugs } }, select: { id: true, name: true, slug: true } });
  for (const p of found) {
    if (DRY) { console.log(`would remove ${p.name}`); continue; }
    await prisma.practice.delete({ where: { id: p.id } }); // cascades through every practice-scoped table
    console.log(`removed ${p.name}`);
  }
  console.log(`${found.length} practice(s) ${DRY ? "would be " : ""}removed`);
}

async function main() {
  const src = await prisma.practice.findUnique({ where: { slug: SOURCE_SLUG } });
  if (!src) throw new Error(`No practice with slug ${SOURCE_SLUG}`);
  if (REMOVE) return removeClones(src.state);
  const wanted = STATES_ARG === "ALL" ? STATES.filter((s) => s[0] !== src.state) : STATES.filter((s) => STATES_ARG.toUpperCase().split(",").includes(s[0]));
  console.log(`Source: ${src.name} (${src.state}). Cloning into ${wanted.length} practice(s)${DRY ? " — dry run" : ""}.`);
  const t0 = Date.now();
  let done = 0;
  for (const st of wanted) {
    const r = await cloneOne(src, st, STATES.findIndex((x) => x[0] === st[0]));
    if (r) done++;
  }
  console.log(`Done: ${done} practice(s) in ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
