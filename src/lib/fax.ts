import "server-only";
import { randomBytes } from "node:crypto";
import { normalizePhone } from "@/lib/patient-docs";

// Fax service connector. MOCK stands in until a real fax API (SRFax, Phaxio, eFax Corporate, Documo...)
// is connected in Facility setup: it accepts any valid 10-digit US number and fails the rest.
export type FaxSendResult = { status: "SUCCESS" | "FAILURE"; providerRef?: string; error?: string; pages: number };

export interface FaxAdapter {
  name: string;
  send(input: { to: string; recipientName: string | null; pages: number; title: string }): Promise<FaxSendResult>;
}

const mock: FaxAdapter = {
  name: "Test fax line (built-in)",
  async send({ to, pages }) {
    const digits = to.replace(/\D/g, "");
    if (digits.length !== 10 || /^(\d)\1+$/.test(digits) || digits.startsWith("555") || digits.startsWith("0") || digits.startsWith("1")) {
      return { status: "FAILURE", error: "Number not reachable (no fax tone)", pages };
    }
    return { status: "SUCCESS", providerRef: `MOCK-${randomBytes(4).toString("hex").toUpperCase()}`, pages };
  },
};

export const FAX_PROVIDERS: Record<string, string> = {
  MOCK: "Test fax line (built-in)",
  SRFAX: "SRFax",
  PHAXIO: "Phaxio",
  EFAX: "eFax Corporate",
  DOCUMO: "Documo (mFax)",
};

export function getFaxAdapter(provider: string | null | undefined): FaxAdapter {
  // Only the test line is wired up; real connectors plug in here.
  void provider;
  return mock;
}

export const FAX_ROLES = ["ADMIN", "FRONT_DESK", "INTAKE", "VERIFICATION", "SCHEDULER", "CLINICIAN"];

export const FAX_RECIPIENTS: Record<string, string> = {
  REFERRING: "Referring physician",
  PCP: "Primary care physician",
  REFERRAL_SOURCE: "Referral source / facility",
  OTHER: "Other (enter number)",
};

export const FAX_STATUS: Record<string, string> = {
  RECEIVED: "Received",
  FILED: "Saved to patient record",
  QUEUED: "Queued",
  PROCESSING: "Processing",
  SUCCESS: "Success",
  FAILURE: "Failure",
  NOT_SENT: "Not sent",
};

export function faxNumberOrNull(v: string | null | undefined) {
  return v ? normalizePhone(v) : null;
}
