// Import the credentialing master workbook as one client with one practice per state.
//
//   npm run import:credentialing -- "C:\path\Credentialling_Single_Master.xlsm"
//
// Re-running replaces the previously imported client (matched by organization name).
// Requires Python 3 with openpyxl for the workbook extraction step.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const ORGANIZATION = "Personic Health";
const DEMO_PASSWORD = "carehub123";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", CT: "Connecticut", FL: "Florida", IL: "Illinois", KY: "Kentucky", MD: "Maryland",
  NY: "New York", PA: "Pennsylvania", TN: "Tennessee", TX: "Texas", VA: "Virginia", WI: "Wisconsin",
};

const SEGMENTS: Record<string, string> = {
  "medicare advantage": "MEDICARE_ADVANTAGE",
  commercial: "COMMERCIAL",
  "medicaid mco": "MEDICAID_MCO",
  "federal program": "FEDERAL",
  "medicare supplemental": "MEDICARE_SUPPLEMENTAL",
  medicare: "MEDICARE",
  medicaid: "MEDICAID",
};

type Cell = { t: "date" | "text"; v: string } | null;
type Extract = {
  states: Record<
    string,
    {
      providers: Record<string, { name: string; credential: string | null }>;
      lines: {
        payer: string;
        planType: string;
        cpid: string | null;
        address: string | null;
        group: Cell;
        edi: Cell;
        eft: Cell;
        cells: Record<string, Cell>;
      }[];
    }
  >;
};

const prisma = new PrismaClient();

// "Igor Shkolnik, MD" / "Shkolnik, Igor" -> { name: "Shkolnik, Igor", credential: "MD" }
function normalizeProvider(raw: string, credential: string | null) {
  let name = raw.trim();
  let cred = credential;
  const trailing = name.match(/,\s*(MD|DO|DPM|NP|FNP|APRN|PA|CRNA|M\.D\.)\.?\s*$/i);
  if (trailing) {
    cred = cred ?? trailing[1].replace(/\./g, "").toUpperCase();
    name = name.slice(0, trailing.index).trim();
  }
  if (!name.includes(",")) {
    const parts = name.split(/\s+/);
    if (parts.length > 1) name = `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
  }
  return { name, credential: cred };
}

function groupStatus(cell: Cell) {
  if (!cell) return { status: "NOT_STARTED", date: null as Date | null };
  if (cell.t === "date") return { status: "APPROVED", date: new Date(`${cell.v}T12:00:00`) };
  const map: Record<string, string> = {
    approved: "APPROVED",
    "panel closed": "PANEL_CLOSED",
    "follows medicare": "FOLLOWS_MEDICARE",
    "in process": "IN_PROCESS",
    remarks: "REMARKS",
    denied: "DENIED",
  };
  return { status: map[cell.v.toLowerCase()] ?? "REMARKS", date: null };
}

function providerStatus(cell: Cell) {
  if (!cell) return { status: "NOT_STARTED", date: null as Date | null, notes: "Blank in master sheet — needs review" };
  if (cell.t === "date") return { status: "APPROVED", date: new Date(`${cell.v}T12:00:00`), notes: null };
  const map: Record<string, string> = {
    approved: "APPROVED",
    "panel closed": "PANEL_CLOSED",
    "follows medicare": "FOLLOWS_PARENT",
    "in process": "SUBMITTED",
    denied: "DENIED",
  };
  const status = map[cell.v.toLowerCase()];
  if (status) return { status, date: null, notes: null };
  // "Remarks" (or any other free text) carried no detail in the sheet; queue it for follow-up.
  return { status: "PAYER_FOLLOW_UP", date: null, notes: `Master sheet said "${cell.v}" — details not recorded` };
}

function connection(cell: Cell) {
  if (!cell) return "NOT_STARTED";
  const v = cell.t === "date" ? "approved" : cell.v.toLowerCase();
  return { approved: "APPROVED", "in process": "IN_PROCESS", "not allowed": "NOT_ALLOWED" }[v] ?? "NOT_STARTED";
}

async function removePreviousImport() {
  const orgs = await prisma.organization.findMany({ where: { name: ORGANIZATION }, include: { practices: true } });
  for (const org of orgs) {
    const ids = org.practices.map((p) => p.id);
    // Users cascade from their home practice; sessions and memberships cascade from users.
    await prisma.practice.deleteMany({ where: { id: { in: ids } } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
}

async function main() {
  const workbook = process.argv[2];
  if (!workbook) throw new Error('Usage: npm run import:credentialing -- "<path to .xlsm>"');

  const dir = mkdtempSync(path.join(tmpdir(), "carehub-import-"));
  const json = path.join(dir, "master.json");
  try {
    execFileSync("python", [path.join(__dirname, "extract_credentialing_master.py"), workbook, json], { stdio: "inherit" });
    const data = JSON.parse(readFileSync(json, "utf8")) as Extract;

    await removePreviousImport();
    const org = await prisma.organization.create({ data: { name: ORGANIZATION } });
    const passwordHash = hashPassword(DEMO_PASSWORD);
    const practiceIds: Record<string, string> = {};
    let lineCount = 0;
    let cellCount = 0;

    for (const [state, sheet] of Object.entries(data.states).sort()) {
      const name = `${ORGANIZATION} - ${STATE_NAMES[state] ?? state}`;
      const practice = await prisma.practice.create({
        data: {
          name,
          slug: `personic-${state.toLowerCase()}`,
          state,
          organizationId: org.id,
          locations: { create: { name: `${STATE_NAMES[state] ?? state} office`, state } },
        },
      });
      practiceIds[state] = practice.id;

      const group = await prisma.billingProvider.create({ data: { practiceId: practice.id, name, state } });

      const providerIds: Record<string, string> = {};
      for (const [col, p] of Object.entries(sheet.providers)) {
        const { name: providerName, credential } = normalizeProvider(p.name, p.credential);
        const [lastName, firstName = ""] = providerName.split(",").map((part) => part.trim());
        const created = await prisma.renderingProvider.create({
          data: {
            practiceId: practice.id,
            name: providerName,
            firstName: firstName || null,
            lastName,
            credential,
            licenseState: state,
            isRendering: true,
            groupName: name,
          },
        });
        providerIds[col] = created.id;
      }

      const payerIds = new Map<string, string>();
      for (const line of sheet.lines) {
        let payerId = payerIds.get(line.payer);
        if (!payerId) {
          const payer = await prisma.payer.create({
            data: { practiceId: practice.id, name: line.payer, payerCode: line.cpid, addressLine1: line.address },
          });
          payerId = payer.id;
          payerIds.set(line.payer, payerId);
        }

        const g = groupStatus(line.group);
        const created = await prisma.groupPayerEnrollment.create({
          data: {
            billingProviderId: group.id,
            payerId,
            planSegment: SEGMENTS[line.planType.toLowerCase()] ?? "COMMERCIAL",
            groupStatus: g.status,
            effectiveDate: g.date,
            ediStatus: connection(line.edi),
            eftStatus: connection(line.eft),
          },
        });
        lineCount += 1;

        const rows = Object.entries(line.cells).map(([col, cell]) => {
          const s = providerStatus(cell);
          return {
            renderingProviderId: providerIds[col],
            groupPayerEnrollmentId: created.id,
            state,
            status: s.status,
            effectiveDate: s.date,
            notes: s.notes,
          };
        });
        await prisma.providerEnrollment.createMany({ data: rows });
        cellCount += rows.length;
      }
    }

    // Master login spanning every practice, plus one single-practice user to compare views.
    const all = Object.values(practiceIds);
    const master = await prisma.user.create({
      data: {
        practiceId: practiceIds.AL ?? all[0],
        email: "master@personic.local",
        username: "master",
        name: "Personic Master",
        role: "ADMIN",
        isMaster: true,
        passwordHash,
      },
    });
    await prisma.membership.createMany({ data: all.map((id) => ({ userId: master.id, practiceId: id, role: "ADMIN" })) });

    if (practiceIds.AL) {
      const al = await prisma.user.create({
        data: {
          practiceId: practiceIds.AL,
          email: "al.credentialing@personic.local",
          username: "al.cred",
          name: "Alabama Credentialing",
          role: "CREDENTIALING",
          passwordHash,
        },
      });
      await prisma.membership.create({ data: { userId: al.id, practiceId: practiceIds.AL, role: "CREDENTIALING" } });
    }

    console.log(
      `Imported ${ORGANIZATION}: ${all.length} practices, ${lineCount} payer lines, ${cellCount} provider statuses.\n` +
        `Logins (password ${DEMO_PASSWORD}): "master" (all practices), "al.cred" (Alabama only).`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
