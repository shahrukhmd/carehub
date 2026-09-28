import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// CMS-1500 (02/12) laid out on the NUCC print grid: 10 characters per inch, 6 lines per inch.
// With `formImage` the red form is drawn too; without it only data prints, for pre-printed forms.

const PAGE_W = 612;
const PAGE_H = 792;
const COL = 7.2; // 1/10 inch
const LINE = 12; // 1/6 inch
const X0 = 18; // left edge of column 1
const Y0 = 6; // top offset of line 0
const RED = rgb(0.84, 0.14, 0.18);
const RED_FILL = rgb(0.99, 0.93, 0.93);
const INK = rgb(0.05, 0.05, 0.1);

const cx = (col: number) => X0 + (col - 1) * COL;
const lineY = (line: number) => PAGE_H - (Y0 + line * LINE) + 2.5; // baseline of a data line, just above the band floor

export type Cms1500Line = {
  from: Date;
  to: Date;
  pos: string;
  emg: boolean;
  cpt: string;
  modifiers: string[];
  pointers: string;
  chargeCents: number;
  units: number;
  renderingNpi: string;
  ndc?: string | null;
};

export type Cms1500Data = {
  payerName: string;
  payerAddress: string[];
  insuranceType: string | null;
  insuredId: string;
  patientName: string;
  patientDob: Date;
  patientSex: string;
  insuredName: string;
  patientAddress: { street: string; city: string; state: string; zip: string; phone: string };
  relationship: string;
  insuredAddress: { street: string; city: string; state: string; zip: string; phone: string };
  insuredGroup: string;
  insuredDob: Date | null;
  insuredSex: string;
  planName: string;
  employment: boolean;
  autoAccident: boolean;
  autoAccidentState: string;
  otherAccident: boolean;
  hasOtherPlan: boolean;
  onsetDate: Date | null;
  otherDate: Date | null;
  unableFrom: Date | null;
  unableTo: Date | null;
  box17: { qualifier: string; name: string; npi: string } | null;
  hospitalFrom: Date | null;
  hospitalTo: Date | null;
  box19: string;
  outsideLab: boolean;
  outsideLabCents: number | null;
  diagnoses: string[];
  resubmissionCode: string;
  originalRef: string;
  priorAuth: string;
  lines: Cms1500Line[];
  taxId: string;
  patientAccount: string;
  acceptAssignment: boolean;
  totalCents: number;
  paidCents: number;
  physicianName: string;
  physicianSignature: { data: Uint8Array; kind: "png" | "jpg" } | null;
  signedDate: Date | null;
  facility: { name: string; street: string; cityStateZip: string; npi: string };
  billing: { name: string; street: string; cityStateZip: string; phone: string; npi: string };
};

const mmddyy = (d: Date | null | undefined) =>
  d ? `${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCFullYear()).slice(2)}` : "";
const mmddyyyy = (d: Date | null | undefined) =>
  d ? `${String(d.getUTCMonth() + 1).padStart(2, "0")} ${String(d.getUTCDate()).padStart(2, "0")} ${d.getUTCFullYear()}` : "";
const dollars = (cents: number) => String(Math.floor(Math.abs(cents) / 100));
const centsPart = (cents: number) => String(Math.abs(cents) % 100).padStart(2, "0");

class Sheet {
  constructor(
    private page: PDFPage,
    private mono: PDFFont,
    private sans: PDFFont,
    private bold: PDFFont
  ) {}

  // Data text on the grid, clipped to its field width.
  text(col: number, line: number, value: string | null | undefined, maxChars = 80) {
    const v = (value ?? "").normalize("NFD").toUpperCase().replace(/[^\x20-\x7E]/g, "").slice(0, maxChars);
    if (!v) return;
    this.page.drawText(v, { x: cx(col), y: lineY(line), size: 10.5, font: this.mono, color: INK });
  }

  // Right-aligned so the last character sits in `endCol`.
  right(endCol: number, line: number, value: string) {
    const v = value.slice(-12);
    this.text(endCol - v.length + 1, line, v);
  }

  x(col: number, line: number, on: boolean) {
    if (on) this.text(col, line, "X");
  }

  // ---- form image ----
  box(c1: number, c2: number, l1: number, l2: number, label = "", fill = false) {
    const x = cx(c1) - 2;
    const w = (c2 - c1 + 1) * COL + 2;
    const top = PAGE_H - (Y0 + (l1 - 1) * LINE) + 2;
    const h = (l2 - l1 + 1) * LINE;
    this.page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: RED, borderWidth: 0.6, color: fill ? RED_FILL : undefined });
    if (label) this.label(c1, l1, label);
  }

  label(col: number, line: number, text: string, size = 5.2) {
    this.page.drawText(text, { x: cx(col) - 0.5, y: PAGE_H - (Y0 + (line - 1) * LINE) - 5.2, size, font: this.sans, color: RED });
  }

  heading(col: number, line: number, text: string, size: number) {
    this.page.drawText(text, { x: cx(col), y: lineY(line), size, font: this.bold, color: RED });
  }

  check(col: number, line: number, caption?: string) {
    this.page.drawRectangle({ x: cx(col) - 1.5, y: lineY(line) - 1.5, width: 8, height: 8, borderColor: RED, borderWidth: 0.6 });
    if (caption) this.page.drawText(caption, { x: cx(col) + 8, y: lineY(line), size: 5, font: this.sans, color: RED });
  }

  get raw() {
    return this.page;
  }
}

function drawForm(s: Sheet) {
  s.heading(1, 5, "HEALTH INSURANCE CLAIM FORM", 13);
  s.label(1, 6, "APPROVED BY NATIONAL UNIFORM CLAIM COMMITTEE (NUCC) 02/12", 5.5);
  s.label(75, 6, "PICA", 6);
  s.label(52, 1, "CARRIER >", 5.5);

  // Row 1
  s.box(1, 48, 7, 8, "1.");
  const programs: [number, string][] = [
    [2, "MEDICARE"],
    [9, "MEDICAID"],
    [16, "TRICARE"],
    [24, "CHAMPVA"],
    [31, "GROUP HEALTH PLAN"],
    [39, "FECA BLK LUNG"],
    [45, "OTHER"],
  ];
  for (const [c, t] of programs) {
    s.label(c, 7, t, 5);
    s.check(c, 8);
  }
  s.box(49, 79, 7, 8, "1a. INSURED'S I.D. NUMBER                          (For Program in Item 1)");
  // Rows 2–4
  s.box(1, 29, 9, 10, "2. PATIENT'S NAME (Last Name, First Name, Middle Initial)");
  s.box(30, 48, 9, 10, "3. PATIENT'S BIRTH DATE          SEX");
  s.check(42, 10, "M");
  s.check(47, 10, "F");
  s.box(49, 79, 9, 10, "4. INSURED'S NAME (Last Name, First Name, Middle Initial)");
  s.box(1, 29, 11, 12, "5. PATIENT'S ADDRESS (No., Street)");
  s.box(30, 48, 11, 12, "6. PATIENT RELATIONSHIP TO INSURED");
  s.check(31, 12, "Self");
  s.check(35, 12, "Spouse");
  s.check(40, 12, "Child");
  s.check(44, 12, "Other");
  s.box(49, 79, 11, 12, "7. INSURED'S ADDRESS (No., Street)");
  s.box(1, 24, 13, 14, "CITY");
  s.box(25, 29, 13, 14, "STATE");
  s.box(30, 48, 13, 16, "8. RESERVED FOR NUCC USE");
  s.box(49, 72, 13, 14, "CITY");
  s.box(73, 79, 13, 14, "STATE");
  s.box(1, 13, 15, 16, "ZIP CODE");
  s.box(14, 29, 15, 16, "TELEPHONE (Include Area Code)");
  s.box(49, 63, 15, 16, "ZIP CODE");
  s.box(64, 79, 15, 16, "TELEPHONE (Include Area Code)");
  // Rows 9–11
  s.box(1, 29, 17, 18, "9. OTHER INSURED'S NAME (Last Name, First Name, Middle Initial)");
  s.box(30, 48, 17, 18, "10. IS PATIENT'S CONDITION RELATED TO:");
  s.box(49, 79, 17, 18, "11. INSURED'S POLICY GROUP OR FECA NUMBER");
  s.box(1, 29, 19, 20, "a. OTHER INSURED'S POLICY OR GROUP NUMBER");
  s.box(30, 48, 19, 20, "a. EMPLOYMENT? (Current or Previous)");
  s.check(35, 20, "YES");
  s.check(41, 20, "NO");
  s.box(49, 79, 19, 20, "a. INSURED'S DATE OF BIRTH                    SEX");
  s.check(68, 20, "M");
  s.check(75, 20, "F");
  s.box(1, 29, 21, 22, "b. RESERVED FOR NUCC USE");
  s.box(30, 48, 21, 22, "b. AUTO ACCIDENT?          PLACE (State)");
  s.check(35, 22, "YES");
  s.check(41, 22, "NO");
  s.box(49, 79, 21, 22, "b. OTHER CLAIM ID (Designated by NUCC)");
  s.box(1, 29, 23, 24, "c. RESERVED FOR NUCC USE");
  s.box(30, 48, 23, 24, "c. OTHER ACCIDENT?");
  s.check(35, 24, "YES");
  s.check(41, 24, "NO");
  s.box(49, 79, 23, 24, "c. INSURANCE PLAN NAME OR PROGRAM NAME");
  s.box(1, 29, 25, 26, "d. INSURANCE PLAN NAME OR PROGRAM NAME");
  s.box(30, 48, 25, 26, "10d. CLAIM CODES (Designated by NUCC)");
  s.box(49, 79, 25, 26, "d. IS THERE ANOTHER HEALTH BENEFIT PLAN?");
  s.check(52, 26, "YES");
  s.check(57, 26, "NO");
  s.label(1, 28, "READ BACK OF FORM BEFORE COMPLETING & SIGNING THIS FORM.", 6);
  s.box(1, 48, 29, 30, "12. PATIENT'S OR AUTHORIZED PERSON'S SIGNATURE — I authorize the release of medical information to process this claim.");
  s.label(2, 30, "SIGNED", 5.5);
  s.label(32, 30, "DATE", 5.5);
  s.box(49, 79, 29, 30, "13. INSURED'S OR AUTHORIZED PERSON'S SIGNATURE — I authorize payment");
  s.label(50, 30, "SIGNED", 5.5);
  // Rows 14–23
  s.box(1, 29, 31, 32, "14. DATE OF CURRENT ILLNESS, INJURY, or PREGNANCY (LMP)   QUAL.");
  s.box(30, 48, 31, 32, "15. OTHER DATE      QUAL.");
  s.box(49, 79, 31, 32, "16. DATES PATIENT UNABLE TO WORK IN CURRENT OCCUPATION  FROM / TO");
  s.box(1, 29, 33, 34, "17. NAME OF REFERRING PROVIDER OR OTHER SOURCE");
  s.box(30, 48, 33, 34, "17a.                17b. NPI");
  s.box(49, 79, 33, 34, "18. HOSPITALIZATION DATES RELATED TO CURRENT SERVICES  FROM / TO");
  s.box(1, 48, 35, 36, "19. ADDITIONAL CLAIM INFORMATION (Designated by NUCC)");
  s.box(49, 79, 35, 36, "20. OUTSIDE LAB?                    $ CHARGES");
  s.check(52, 36, "YES");
  s.check(57, 36, "NO");
  s.box(1, 48, 37, 40, "21. DIAGNOSIS OR NATURE OF ILLNESS OR INJURY — Relate A-L to service line below (24E)      ICD Ind.");
  "ABCDEFGHIJKL".split("").forEach((l, i) => s.label(1 + (i % 4) * 12, 38 + Math.floor(i / 4), `${l}.`, 6));
  s.box(49, 79, 37, 38, "22. RESUBMISSION CODE          ORIGINAL REF. NO.");
  s.box(49, 79, 39, 40, "23. PRIOR AUTHORIZATION NUMBER");
  // Row 24
  s.box(1, 79, 41, 42);
  const heads: [number, string, string][] = [
    [1, "24. A. DATE(S) OF SERVICE", "From MM DD YY    To MM DD YY"],
    [19, "B. PLACE", "OF SVC"],
    [22, "C.", "EMG"],
    [25, "D. PROCEDURES, SERVICES, OR SUPPLIES", "CPT/HCPCS          MODIFIER"],
    [44, "E. DIAGNOSIS", "POINTER"],
    [49, "F.", "$ CHARGES"],
    [60, "G. DAYS", "OR UNITS"],
    [64, "H.", "EPSDT"],
    [66, "I. ID", "QUAL."],
    [69, "J. RENDERING", "PROVIDER ID. #"],
  ];
  for (const [c, t1, t2] of heads) {
    s.label(c, 41, t1, 4.6);
    s.label(c, 42, t2, 4.6);
  }
  for (let i = 0; i < 6; i++) {
    const top = 43 + i * 2;
    s.box(1, 79, top, top, "", true); // shaded supplemental line
    s.box(1, 79, top + 1, top + 1);
    s.label(0, top + 1, String(i + 1), 6); // line number in the left margin
  }
  // Row 25–33
  s.box(1, 22, 55, 56, "25. FEDERAL TAX I.D. NUMBER");
  s.label(17, 55, "SSN", 5);
  s.label(19.6, 55, "EIN", 5);
  s.check(17.5, 56);
  s.check(20, 56);
  s.box(23, 36, 55, 56, "26. PATIENT'S ACCOUNT NO.");
  s.box(37, 48, 55, 56, "27. ACCEPT ASSIGNMENT?");
  s.check(38, 56, "YES");
  s.check(43, 56, "NO");
  s.box(49, 60, 55, 56, "28. TOTAL CHARGE");
  s.box(61, 70, 55, 56, "29. AMOUNT PAID");
  s.box(71, 79, 55, 56, "30. Rsvd for NUCC Use");
  s.box(1, 22, 57, 62, "31. SIGNATURE OF PHYSICIAN OR SUPPLIER");
  s.label(1, 58, "INCLUDING DEGREES OR CREDENTIALS", 4.6);
  s.box(23, 48, 57, 62, "32. SERVICE FACILITY LOCATION INFORMATION");
  s.box(49, 79, 57, 62, "33. BILLING PROVIDER INFO & PH #");
  s.label(23, 62, "a.", 6);
  s.label(34, 62, "b.", 6);
  s.label(49, 62, "a.", 6);
  s.label(61, 62, "b.", 6);
  s.label(1, 64, "NUCC Instruction Manual available at: www.nucc.org        APPROVED OMB-0938-1197 FORM 1500 (02-12)", 5.5);
}

export async function renderCms1500(d: Cms1500Data, formImage: boolean) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`CMS-1500 ${d.patientAccount}`);
  pdf.setCreator("CareHub");
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const signature = d.physicianSignature
    ? d.physicianSignature.kind === "png"
      ? await pdf.embedPng(d.physicianSignature.data)
      : await pdf.embedJpg(d.physicianSignature.data)
    : null;

  // Six service lines per form; more lines continue on further pages with the header repeated.
  const pages = Math.max(1, Math.ceil(d.lines.length / 6));
  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    const s = new Sheet(page, mono, sans, bold);
    if (formImage) drawForm(s);
    const lines = d.lines.slice(p * 6, p * 6 + 6);
    const last = p === pages - 1;

    // Carrier block
    s.text(50, 2, d.payerName, 30);
    d.payerAddress.slice(0, 3).forEach((l, i) => s.text(50, 3 + i, l, 30));

    // 1 / 1a
    const typeCol: Record<string, number> = { MEDICARE: 2, MEDICAID: 9, TRICARE: 16, CHAMPVA: 24, GROUP: 31, FECA: 39, OTHER: 45 };
    s.x(typeCol[d.insuranceType ?? ""] ?? 31, 8, true);
    s.text(50, 8, d.insuredId, 29);
    // 2 / 3 / 4
    s.text(2, 10, d.patientName, 28);
    s.text(31, 10, mmddyyyy(d.patientDob));
    s.x(42, 10, d.patientSex === "M");
    s.x(47, 10, d.patientSex === "F");
    s.text(50, 10, d.insuredName, 29);
    // 5 / 6 / 7
    s.text(2, 12, d.patientAddress.street, 28);
    const relCol: Record<string, number> = { "18": 31, "01": 35, "19": 40, G8: 44 };
    s.x(relCol[d.relationship] ?? 44, 12, true);
    s.text(50, 12, d.insuredAddress.street, 29);
    s.text(2, 14, d.patientAddress.city, 23);
    s.text(26, 14, d.patientAddress.state, 3);
    s.text(50, 14, d.insuredAddress.city, 23);
    s.text(74, 14, d.insuredAddress.state, 3);
    s.text(2, 16, d.patientAddress.zip, 12);
    s.text(15, 16, d.patientAddress.phone, 15);
    s.text(50, 16, d.insuredAddress.zip, 13);
    s.text(65, 16, d.insuredAddress.phone, 15);
    // 10 / 11
    s.text(50, 18, d.insuredGroup, 29);
    s.x(35, 20, d.employment);
    s.x(41, 20, !d.employment);
    s.text(53, 20, mmddyyyy(d.insuredDob));
    s.x(68, 20, d.insuredSex === "M");
    s.x(75, 20, d.insuredSex === "F");
    s.x(35, 22, d.autoAccident);
    s.x(41, 22, !d.autoAccident);
    s.text(45, 22, d.autoAccidentState, 2);
    s.x(35, 24, d.otherAccident);
    s.x(41, 24, !d.otherAccident);
    s.text(50, 24, d.planName, 29);
    s.x(52, 26, d.hasOtherPlan);
    s.x(57, 26, !d.hasOtherPlan);
    // 12 / 13
    s.text(7, 30, "SIGNATURE ON FILE");
    s.text(37, 30, mmddyy(d.signedDate ?? new Date()));
    s.text(56, 30, "SIGNATURE ON FILE");
    // 14 – 18
    if (d.onsetDate) {
      s.text(3, 32, mmddyy(d.onsetDate));
      s.text(13, 32, "431");
    }
    if (d.otherDate) {
      s.text(33, 32, "454");
      s.text(38, 32, mmddyy(d.otherDate));
    }
    s.text(54, 32, mmddyy(d.unableFrom));
    s.text(68, 32, mmddyy(d.unableTo));
    if (d.box17) {
      s.text(1, 34, d.box17.qualifier, 2);
      s.text(4, 34, d.box17.name, 25);
      s.text(34, 34, d.box17.npi, 10);
    }
    s.text(54, 34, mmddyy(d.hospitalFrom));
    s.text(68, 34, mmddyy(d.hospitalTo));
    // 19 / 20
    s.text(2, 36, d.box19, 46);
    s.x(52, 36, d.outsideLab);
    s.x(57, 36, !d.outsideLab);
    if (d.outsideLab && d.outsideLabCents) {
      s.right(68, 36, dollars(d.outsideLabCents));
      s.text(70, 36, centsPart(d.outsideLabCents));
    }
    // 21 – 23
    s.text(45, 37, "0");
    d.diagnoses.slice(0, 12).forEach((code, i) => s.text(3 + (i % 4) * 12, 38 + Math.floor(i / 4), code.replace(".", ""), 8));
    s.text(50, 38, d.resubmissionCode, 4);
    s.text(62, 38, d.originalRef, 18);
    s.text(50, 40, d.priorAuth, 29);
    // 24
    lines.forEach((l, i) => {
      const main = 44 + i * 2;
      if (l.ndc) s.text(1, main - 1, `N4${l.ndc}`, 20);
      s.text(1, main, mmddyy(l.from));
      s.text(10, main, mmddyy(l.to));
      s.text(19, main, l.pos, 2);
      s.x(22, main, l.emg);
      s.text(25, main, l.cpt, 6);
      l.modifiers.slice(0, 4).forEach((m, k) => s.text(32 + k * 3, main, m, 2));
      s.text(44, main, l.pointers.replaceAll(",", ""), 4);
      s.right(55, main, dollars(l.chargeCents));
      s.text(57, main, centsPart(l.chargeCents));
      s.text(60, main, String(l.units), 3);
      s.text(69, main, l.renderingNpi, 11);
    });
    // 25 – 30
    s.text(2, 56, d.taxId, 15);
    s.x(20, 56, true); // EIN
    s.text(23, 56, d.patientAccount, 14);
    s.x(38, 56, d.acceptAssignment);
    s.x(43, 56, !d.acceptAssignment);
    const pageTotal = last ? d.totalCents : lines.reduce((sum, l) => sum + l.chargeCents, 0);
    s.right(57, 56, dollars(pageTotal));
    s.text(58, 56, centsPart(pageTotal));
    if (last) {
      s.right(67, 56, dollars(d.paidCents));
      s.text(68, 56, centsPart(d.paidCents));
    } else {
      s.text(62, 56, "CONTINUED");
    }
    // 31
    if (signature) {
      const maxW = 21 * COL;
      const maxH = 2.3 * LINE;
      const scale = Math.min(maxW / signature.width, maxH / signature.height);
      s.raw.drawImage(signature, {
        x: cx(1),
        y: lineY(60) - 2,
        width: signature.width * scale,
        height: signature.height * scale,
      });
    } else {
      s.text(1, 59, "SIGNATURE ON FILE", 21);
    }
    s.text(1, 61, d.physicianName, 21);
    s.text(1, 62, mmddyy(d.signedDate), 10);
    // 32
    s.text(23, 58, d.facility.name, 26);
    s.text(23, 59, d.facility.street, 26);
    s.text(23, 60, d.facility.cityStateZip, 26);
    s.text(24, 62, d.facility.npi, 10);
    // 33
    s.text(66, 57, d.billing.phone, 14);
    s.text(49, 58, d.billing.name, 31);
    s.text(49, 59, d.billing.street, 31);
    s.text(49, 60, d.billing.cityStateZip, 31);
    s.text(50, 62, d.billing.npi, 10);
    if (pages > 1) s.text(71, 64, `PAGE ${p + 1}/${pages}`);
  }
  return pdf.save();
}
