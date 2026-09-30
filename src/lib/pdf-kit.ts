import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Small PDF helpers shared by prescriptions, letters and labels (Letter size, WinAnsi-safe text).

export const pdfSafe = (s: string) =>
  s
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/→/g, "->")
    .replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, "");

export const INK = rgb(0.1, 0.1, 0.15);
export const MUTED = rgb(0.42, 0.45, 0.5);

export async function newPdf(title: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(title));
  pdf.setCreator("CareHub");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  return { pdf, font, bold };
}

export class Flow {
  page: PDFPage;
  y = 0;
  constructor(
    public pdf: PDFDocument,
    public font: PDFFont,
    public bold: PDFFont,
    private top = 740,
    private bottom = 60
  ) {
    this.page = this.addPage();
  }
  addPage() {
    this.page = this.pdf.addPage([612, 792]);
    this.y = this.top;
    return this.page;
  }
  ensure(h: number) {
    if (this.y - h < this.bottom) this.addPage();
  }
  wrap(text: string, size: number, width: number, font: PDFFont) {
    const out: string[] = [];
    for (const para of pdfSafe(text).split(/\n/)) {
      let line = "";
      for (const word of para.split(/ +/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }
  text(text: string, { size = 10.5, bold = false, x = 60, width = 492, color = INK, gap = 4 } = {}) {
    const font = bold ? this.bold : this.font;
    for (const line of this.wrap(text, size, width, font)) {
      this.ensure(size + gap);
      this.page.drawText(line, { x, y: this.y - size, size, font, color });
      this.y -= size + gap;
    }
  }
  gap(h: number) {
    this.y -= h;
  }
  rule(color = rgb(0.8, 0.82, 0.86)) {
    this.page.drawLine({ start: { x: 60, y: this.y }, end: { x: 552, y: this.y }, thickness: 0.8, color });
    this.y -= 8;
  }
  async signature(dataUrl: string | null | undefined, x = 60, maxW = 200, maxH = 50) {
    if (!dataUrl?.startsWith("data:image/png;base64,")) return false;
    const img = await this.pdf.embedPng(Buffer.from(dataUrl.split(",")[1], "base64"));
    const scale = Math.min(maxW / img.width, maxH / img.height);
    this.ensure(img.height * scale + 6);
    this.page.drawImage(img, { x, y: this.y - img.height * scale, width: img.width * scale, height: img.height * scale });
    this.y -= img.height * scale + 4;
    return true;
  }
}

// Letterhead block: practice name + address + phone, centred rule.
export function letterhead(f: Flow, p: { name: string; line1?: string | null; line2?: string | null; phone?: string | null; fax?: string | null }) {
  f.text(p.name, { size: 15, bold: true });
  const contact = [p.line1, p.line2].filter(Boolean).join(" · ");
  if (contact) f.text(contact, { size: 9.5, color: MUTED, gap: 2 });
  const tel = [p.phone ? `Phone ${p.phone}` : "", p.fax ? `Fax ${p.fax}` : ""].filter(Boolean).join(" · ");
  if (tel) f.text(tel, { size: 9.5, color: MUTED, gap: 2 });
  f.gap(4);
  f.rule();
  f.gap(6);
}
