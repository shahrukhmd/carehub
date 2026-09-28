import "server-only";
import { prisma } from "@/lib/prisma";
import {
  ACTIVE_ENROLLMENT_STATUSES,
  MONTHLY_SCREENING_SOURCES,
  OPEN_ENROLLMENT_STATUSES,
  providerDocumentTypeLabel,
  verificationSourceLabel,
} from "@/lib/format";

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_FOLLOW_UP_DAYS = 14;
const STALE_STATUSES = ["DOCUMENTS_PENDING", "SUBMITTED", "PAYER_FOLLOW_UP", "BLOCKED"];

export function daysBetween(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

// Every active provider needs a row for every group-payer line, mirroring the
// provider-column x payer-row grid in the credentialing master workbook.
export async function ensureEnrollmentsForProvider(renderingProviderId: string) {
  const provider = await prisma.renderingProvider.findUniqueOrThrow({ where: { id: renderingProviderId } });
  // Referring-only providers do not bill, so they are never credentialed with payers.
  if (provider.status !== "ACTIVE" || !provider.isRendering) return 0;

  const [lines, existing] = await Promise.all([
    prisma.groupPayerEnrollment.findMany({
      where: { billingProvider: { practiceId: provider.practiceId, active: true } },
      include: { billingProvider: true },
    }),
    prisma.providerEnrollment.findMany({ where: { renderingProviderId }, select: { groupPayerEnrollmentId: true } }),
  ]);
  const have = new Set(existing.map((e) => e.groupPayerEnrollmentId));
  const missing = lines.filter((l) => !have.has(l.id));
  if (missing.length === 0) return 0;

  await prisma.providerEnrollment.createMany({
    data: missing.map((l) => ({
      renderingProviderId,
      groupPayerEnrollmentId: l.id,
      state: l.billingProvider.state,
      planTypes: l.planType,
    })),
  });
  return missing.length;
}

export async function ensureEnrollmentsForGroupPayer(groupPayerEnrollmentId: string) {
  const line = await prisma.groupPayerEnrollment.findUniqueOrThrow({
    where: { id: groupPayerEnrollmentId },
    include: { billingProvider: true },
  });
  const [providers, existing] = await Promise.all([
    prisma.renderingProvider.findMany({
      where: { practiceId: line.billingProvider.practiceId, status: "ACTIVE", isRendering: true },
      select: { id: true },
    }),
    prisma.providerEnrollment.findMany({ where: { groupPayerEnrollmentId }, select: { renderingProviderId: true } }),
  ]);
  const have = new Set(existing.map((e) => e.renderingProviderId));
  const missing = providers.filter((p) => !have.has(p.id));
  if (missing.length === 0) return 0;

  await prisma.providerEnrollment.createMany({
    data: missing.map((p) => ({
      renderingProviderId: p.id,
      groupPayerEnrollmentId,
      state: line.billingProvider.state,
      planTypes: line.planType,
    })),
  });
  return missing.length;
}

// Clinician logins double as rendering providers; keep a linked directory record for each.
export async function ensureRenderingProviderForUser(userId: string, practiceId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { renderingProvider: true } });
  if (user.renderingProvider) return user.renderingProvider.id;

  const created = await prisma.renderingProvider.create({
    data: {
      practiceId,
      userId: user.id,
      name: user.name,
      npi: user.npi,
      specialty: user.specialty,
      isClinician: true,
      isRendering: true,
    },
  });
  await ensureEnrollmentsForProvider(created.id);
  return created.id;
}

export type CredentialingAlert = {
  key: string;
  kind: "DOCUMENT" | "FOLLOW_UP" | "STALE" | "REVALIDATION" | "SCREENING";
  severity: "high" | "medium";
  title: string;
  detail: string;
  href: string;
  dueDate: Date | null;
  assignedToId: string | null;
  practiceName: string;
};

export async function getCredentialingAlerts(practiceIds: string[]): Promise<CredentialingAlert[]> {
  const practiceId = { in: practiceIds };
  const now = new Date();
  const in90 = new Date(now.getTime() + 90 * DAY_MS);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const [documents, enrollments, providers] = await Promise.all([
    prisma.providerDocument.findMany({
      where: {
        supersededAt: null,
        expiryDate: { not: null, lte: in90 },
        renderingProvider: { practiceId, status: "ACTIVE" },
      },
      include: { renderingProvider: { include: { practice: true } } },
    }),
    prisma.providerEnrollment.findMany({
      where: {
        renderingProvider: { practiceId },
        status: { in: [...OPEN_ENROLLMENT_STATUSES, ...ACTIVE_ENROLLMENT_STATUSES] },
      },
      include: {
        renderingProvider: { include: { practice: true } },
        groupPayerEnrollment: { include: { payer: true } },
      },
    }),
    prisma.renderingProvider.findMany({
      where: { practiceId, status: "ACTIVE", isRendering: true },
      include: { practice: true, verificationChecks: { orderBy: { checkedAt: "desc" } } },
    }),
  ]);

  const alerts: CredentialingAlert[] = [];

  for (const d of documents) {
    const days = daysBetween(now, d.expiryDate!);
    alerts.push({
      key: `doc-${d.id}`,
      kind: "DOCUMENT",
      severity: days <= 30 ? "high" : "medium",
      title: `${providerDocumentTypeLabel[d.type] ?? d.type} ${days < 0 ? "expired" : "expiring"} — ${d.renderingProvider.name}`,
      detail: days < 0 ? `Expired ${-days} day(s) ago` : `Expires in ${days} day(s)`,
      href: `/credentialing/providers/${d.renderingProviderId}`,
      dueDate: d.expiryDate,
      assignedToId: null,
      practiceName: d.renderingProvider.practice.name,
    });
  }

  for (const e of enrollments) {
    const payer = e.groupPayerEnrollment.payer.name;
    const href = `/credentialing/enrollments/${e.id}`;
    const isOpen = OPEN_ENROLLMENT_STATUSES.includes(e.status);

    if (isOpen && e.followUpDate && e.followUpDate <= endOfToday) {
      const overdue = daysBetween(e.followUpDate, now);
      alerts.push({
        key: `fu-${e.id}`,
        kind: "FOLLOW_UP",
        severity: overdue > 0 ? "high" : "medium",
        title: `Follow-up due — ${e.renderingProvider.name} / ${payer}`,
        detail: overdue > 0 ? `Overdue by ${overdue} day(s)` : "Due today",
        href,
        dueDate: e.followUpDate,
        assignedToId: e.assignedToId,
        practiceName: e.renderingProvider.practice.name,
      });
    }

    if (STALE_STATUSES.includes(e.status)) {
      const last = e.lastActivityAt ?? e.statusChangedAt;
      const silent = daysBetween(last, now);
      if (silent >= STALE_FOLLOW_UP_DAYS) {
        alerts.push({
          key: `stale-${e.id}`,
          kind: "STALE",
          severity: silent >= STALE_FOLLOW_UP_DAYS * 2 ? "high" : "medium",
          title: `No activity logged — ${e.renderingProvider.name} / ${payer}`,
          detail: `${silent} days without a follow-up entry`,
          href,
          dueDate: null,
          assignedToId: e.assignedToId,
          practiceName: e.renderingProvider.practice.name,
        });
      }
    }

    if (ACTIVE_ENROLLMENT_STATUSES.includes(e.status) && e.revalidationDate && e.revalidationDate <= in90) {
      const days = daysBetween(now, e.revalidationDate);
      alerts.push({
        key: `reval-${e.id}`,
        kind: "REVALIDATION",
        severity: days <= 30 ? "high" : "medium",
        title: `Revalidation / recredentialing due — ${e.renderingProvider.name} / ${payer}`,
        detail: days < 0 ? `Past due by ${-days} day(s)` : `Due in ${days} day(s)`,
        href,
        dueDate: e.revalidationDate,
        assignedToId: e.assignedToId,
        practiceName: e.renderingProvider.practice.name,
      });
    }
  }

  for (const p of providers) {
    for (const source of MONTHLY_SCREENING_SOURCES) {
      const latest = p.verificationChecks.find((c) => c.source === source);
      const label = verificationSourceLabel[source] ?? source;
      if (latest?.result === "FLAGGED") {
        alerts.push({
          key: `flag-${p.id}-${source}`,
          kind: "SCREENING",
          severity: "high",
          title: `${label} flag — ${p.name}`,
          detail: `Flagged on ${latest.checkedAt.toLocaleDateString("en-US")}; escalate for review`,
          href: `/credentialing/providers/${p.id}`,
          dueDate: null,
          assignedToId: null,
          practiceName: p.practice.name,
        });
      } else if (!latest || daysBetween(latest.checkedAt, now) > 30) {
        alerts.push({
          key: `screen-${p.id}-${source}`,
          kind: "SCREENING",
          severity: "medium",
          title: `${label} screening due — ${p.name}`,
          detail: latest ? `Last screened ${daysBetween(latest.checkedAt, now)} days ago (30-day cycle)` : "Never screened",
          href: `/credentialing/providers/${p.id}`,
          dueDate: null,
          assignedToId: null,
          practiceName: p.practice.name,
        });
      }
    }
  }

  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}

export type NppesResult = {
  npi: string;
  name: string;
  credential: string | null;
  taxonomy: string | null;
  address: string | null;
};

export async function lookupNppes(params: { npi?: string; firstName?: string; lastName?: string }) {
  const url = new URL("https://npiregistry.cms.hhs.gov/api/");
  url.searchParams.set("version", "2.1");
  url.searchParams.set("limit", "10");
  if (params.npi) url.searchParams.set("number", params.npi);
  if (params.firstName) url.searchParams.set("first_name", params.firstName);
  if (params.lastName) url.searchParams.set("last_name", params.lastName);

  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`NPPES returned ${res.status}`);
  const body = (await res.json()) as {
    Errors?: { description: string }[];
    results?: {
      number: string;
      basic?: { first_name?: string; last_name?: string; organization_name?: string; credential?: string };
      taxonomies?: { desc?: string; primary?: boolean }[];
      addresses?: { address_purpose?: string; address_1?: string; city?: string; state?: string; postal_code?: string }[];
    }[];
  };
  if (body.Errors?.length) throw new Error(body.Errors.map((e) => e.description).join("; "));

  return (body.results ?? []).map<NppesResult>((r) => {
    const basic = r.basic ?? {};
    const taxonomy = r.taxonomies?.find((t) => t.primary) ?? r.taxonomies?.[0];
    const address = r.addresses?.find((a) => a.address_purpose === "LOCATION") ?? r.addresses?.[0];
    return {
      npi: r.number,
      name: basic.organization_name ?? [basic.first_name, basic.last_name].filter(Boolean).join(" "),
      credential: basic.credential ?? null,
      taxonomy: taxonomy?.desc ?? null,
      address: address
        ? [address.address_1, address.city, address.state, address.postal_code?.slice(0, 5)].filter(Boolean).join(", ")
        : null,
    };
  });
}

// Patient Gateway link: is each rendering provider credentialed with the patient's payer?
export type NetworkStatus = {
  providerId: string;
  providerName: string;
  credential: string | null;
  // IN_NETWORK: an active enrollment. PENDING: enrollment still being worked. NOT_ENROLLED: nothing usable.
  network: "IN_NETWORK" | "PENDING" | "NOT_ENROLLED";
  status: string | null;
  planSegment: string | null;
  effectiveDate: Date | null;
  enrollmentId: string | null;
};

const NETWORK_RANK = { IN_NETWORK: 0, PENDING: 1, NOT_ENROLLED: 2 } as const;

export async function networkStatusForPayer(
  practiceId: string,
  payerId: string,
  planSegment?: string | null
): Promise<NetworkStatus[]> {
  const payer = await prisma.payer.findFirst({
    where: { id: payerId, practiceId },
    select: { id: true, parentPayerId: true },
  });
  if (!payer) return [];
  // A payer that follows a parent (e.g. a Medicare Advantage plan following Medicare) inherits its lines.
  const payerIds = [payer.id, payer.parentPayerId].filter((id): id is string => Boolean(id));

  const providers = await prisma.renderingProvider.findMany({
    where: { practiceId, isRendering: true, status: "ACTIVE" },
    orderBy: { name: "asc" },
    include: {
      enrollments: {
        where: {
          groupPayerEnrollment: { payerId: { in: payerIds }, ...(planSegment ? { planSegment } : {}) },
        },
        include: { groupPayerEnrollment: true },
      },
    },
  });

  return providers
    .map((p) => {
      let best: NetworkStatus = {
        providerId: p.id,
        providerName: p.name,
        credential: p.credential,
        network: "NOT_ENROLLED",
        status: null,
        planSegment: null,
        effectiveDate: null,
        enrollmentId: null,
      };
      for (const e of p.enrollments) {
        const network = ACTIVE_ENROLLMENT_STATUSES.includes(e.status)
          ? "IN_NETWORK"
          : OPEN_ENROLLMENT_STATUSES.includes(e.status)
            ? "PENDING"
            : "NOT_ENROLLED";
        const better =
          NETWORK_RANK[network] < NETWORK_RANK[best.network] || (best.enrollmentId === null && network === best.network);
        if (better) {
          best = {
            ...best,
            network,
            status: e.status,
            planSegment: e.groupPayerEnrollment.planSegment,
            effectiveDate: e.effectiveDate,
            enrollmentId: e.id,
          };
        }
      }
      return best;
    })
    .sort((a, b) => NETWORK_RANK[a.network] - NETWORK_RANK[b.network] || a.providerName.localeCompare(b.providerName));
}
