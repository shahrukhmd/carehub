"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  connectionStatusLabel,
  credentialingStatusLabel,
  enrollmentStatusLabel,
  statusShortCode,
} from "@/lib/format";

export type GridCell = {
  id: string;
  status: string;
  effectiveDate: string | null;
  remarks: string | null;
  payerProviderId: string | null;
};

export type GridRow = {
  lineId: string;
  payer: string;
  segment: string;
  payerId: string | null;
  groupStatus: string;
  ediStatus: string;
  eftStatus: string;
  groupEffectiveDate: string | null;
  // The number the payer assigned to the group for this line.
  groupNumber: string | null;
  groupRemarks: string | null;
  cells: Record<string, GridCell>;
};

export type GridProvider = { id: string; name: string; credential: string | null };

type EditTarget =
  | { kind: "cell"; row: GridRow; provider: GridProvider; cell: GridCell }
  | { kind: "group"; row: GridRow; field: "groupStatus" | "ediStatus" | "eftStatus" };

type Editing = EditTarget & { rect: DOMRect };

type Props = {
  rows: GridRow[];
  providers: GridProvider[];
  updateCell: (enrollmentId: string, formData: FormData) => Promise<void>;
  updateGroup: (lineId: string, field: string, formData: FormData) => Promise<void>;
  enrollmentBasePath?: string;
  // Provider column headings link to the provider's own file when set.
  providerBasePath?: string;
};

const TONES: Record<string, string> = {
  APPROVED: "ok",
  FOLLOWS_PARENT: "ok",
  FOLLOWS_MEDICARE: "ok",
  SUBMITTED: "warn",
  IN_PROCESS: "warn",
  PAYER_FOLLOW_UP: "warn",
  DOCUMENTS_PENDING: "warn",
  REVALIDATION_DUE: "warn",
  REMARKS: "info",
  BLOCKED: "bad",
  PANEL_CLOSED: "bad",
  DENIED: "bad",
  NOT_ALLOWED: "bad",
  TERMED: "mute",
  NOT_APPLICABLE: "mute",
  NOT_STARTED: "empty",
};

function shortDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
}

function shortName(name: string) {
  const parts = name.replace(/,.*$/, "").trim().split(/\s+/);
  if (name.includes(",")) {
    const [last, first] = name.split(",").map((s) => s.trim());
    return `${last}, ${first?.[0] ?? ""}.`;
  }
  return parts.length > 1 ? `${parts[parts.length - 1]}, ${parts[0][0]}.` : name;
}

export function StatusGrid({ rows, providers, updateCell, updateGroup, enrollmentBasePath, providerBasePath }: Props) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showDates, setShowDates] = useState(true);
  const [openOnly, setOpenOnly] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEditing(null);
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [editing]);

  const visible = useMemo(() => {
    if (!openOnly) return rows;
    return rows.filter((r) =>
      Object.values(r.cells).some((c) => !["APPROVED", "FOLLOWS_PARENT", "TERMED", "NOT_APPLICABLE"].includes(c.status))
    );
  }, [rows, openOnly]);

  const single = providers.length === 1;

  function open(e: React.MouseEvent<HTMLButtonElement>, next: EditTarget) {
    setError(null);
    setEditing({ ...next, rect: e.currentTarget.getBoundingClientRect() });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const target = editing;
    startTransition(async () => {
      try {
        if (target.kind === "cell") await updateCell(target.cell.id, fd);
        else await updateGroup(target.row.lineId, target.field, fd);
        setEditing(null);
      } catch {
        setError("Could not save — you may not have access to this record.");
      }
    });
  }

  const statusOptions =
    editing?.kind === "cell"
      ? enrollmentStatusLabel
      : editing?.field === "groupStatus"
        ? credentialingStatusLabel
        : connectionStatusLabel;
  const currentStatus =
    editing?.kind === "cell" ? editing.cell.status : editing ? editing.row[editing.field] : "";

  // Keep the popover on screen: open below the cell, or above it near the bottom edge.
  const popoverStyle = editing
    ? {
        left: Math.min(editing.rect.left, (typeof window !== "undefined" ? window.innerWidth : 1200) - 290),
        top:
          editing.rect.bottom + 300 > (typeof window !== "undefined" ? window.innerHeight : 800)
            ? Math.max(8, editing.rect.top - 300)
            : editing.rect.bottom + 4,
      }
    : undefined;

  return (
    <div className="sgrid-wrap">
      <div className="sgrid-toolbar">
        <label className="checkbox-inline">
          <input type="checkbox" checked={showDates} onChange={(e) => setShowDates(e.target.checked)} />
          Show dates
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Only rows with open items
        </label>
        <span className="muted">
          {visible.length} payer lines × {providers.length} provider{providers.length === 1 ? "" : "s"} · click any cell
          to edit
        </span>
      </div>

      <div className="sgrid-scroll">
        <table className={`sgrid${showDates ? "" : " sgrid-nodates"}`}>
          <thead>
            <tr>
              <th className="sgrid-sticky sgrid-payer">Payer</th>
              <th className="sgrid-sticky sgrid-seg">Plan segment</th>
              <th className="sgrid-sticky sgrid-cpid">Payer ID</th>
              <th className="sgrid-grp">Group</th>
              <th className="sgrid-grp">EDI</th>
              <th className="sgrid-grp sgrid-grp-end">EFT</th>
              {providers.map((p) => (
                <th key={p.id} className="sgrid-prov" title={`${p.name}${p.credential ? `, ${p.credential}` : ""}`}>
                  <span>
                    {providerBasePath ? (
                      <a href={`${providerBasePath}${p.id}`}>
                        {single ? p.name : shortName(p.name)}
                        {p.credential ? ` ${p.credential}` : ""}
                      </a>
                    ) : (
                      <>
                        {single ? p.name : shortName(p.name)}
                        {p.credential ? ` ${p.credential}` : ""}
                      </>
                    )}
                  </span>
                </th>
              ))}
              {single && (
                <>
                  <th>Effective</th>
                  <th>Payer provider #</th>
                  <th>Remarks</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const newPayer = i === 0 || visible[i - 1].payer !== r.payer;
              const only = single ? r.cells[providers[0].id] : null;
              return (
                <tr key={r.lineId} className={newPayer ? "sgrid-newpayer" : ""}>
                  <td className="sgrid-sticky sgrid-payer" title={r.payer}>
                    {newPayer ? r.payer : ""}
                  </td>
                  <td className="sgrid-sticky sgrid-seg">{r.segment}</td>
                  <td className="sgrid-sticky sgrid-cpid">{r.payerId ?? ""}</td>
                  {(["groupStatus", "ediStatus", "eftStatus"] as const).map((field) => (
                    <td key={field} className={`sgrid-grp${field === "eftStatus" ? " sgrid-grp-end" : ""}`}>
                      <button
                        type="button"
                        className={`scell tone-${TONES[r[field]] ?? "info"}`}
                        title={`${field === "groupStatus" ? credentialingStatusLabel[r[field]] : connectionStatusLabel[r[field]]}${field === "groupStatus" && r.groupNumber ? ` · group # ${r.groupNumber}` : ""}${field === "groupStatus" && r.groupRemarks ? ` — ${r.groupRemarks}` : ""}`}
                        onClick={(e) => open(e, { kind: "group", row: r, field })}
                      >
                        {statusShortCode[r[field]] ?? r[field]}
                        {field === "groupStatus" && r.groupEffectiveDate && <small>{shortDate(r.groupEffectiveDate)}</small>}
                        {field === "groupStatus" && r.groupRemarks && <i className="scell-dot" />}
                      </button>
                    </td>
                  ))}
                  {providers.map((p) => {
                    const c = r.cells[p.id];
                    if (!c) return <td key={p.id} className="sgrid-none" />;
                    return (
                      <td key={p.id}>
                        <button
                          type="button"
                          className={`scell tone-${TONES[c.status] ?? "info"}`}
                          title={`${p.name} · ${r.payer} ${r.segment}: ${enrollmentStatusLabel[c.status]}${c.payerProviderId ? ` · provider # ${c.payerProviderId}` : ""}${c.effectiveDate ? ` (eff. ${new Date(c.effectiveDate).toLocaleDateString("en-US", { timeZone: "UTC" })})` : ""}${c.remarks ? ` — ${c.remarks}` : ""}`}
                          onClick={(e) => open(e, { kind: "cell", row: r, provider: p, cell: c })}
                        >
                          {statusShortCode[c.status] ?? c.status}
                          {c.effectiveDate && <small>{shortDate(c.effectiveDate)}</small>}
                          {c.remarks && <i className="scell-dot" />}
                        </button>
                      </td>
                    );
                  })}
                  {single && (
                    <>
                      <td className="sgrid-text">
                        {only?.effectiveDate ? new Date(only.effectiveDate).toLocaleDateString("en-US", { timeZone: "UTC" }) : ""}
                      </td>
                      <td className="sgrid-text">{only?.payerProviderId ?? ""}</td>
                      <td className="sgrid-text sgrid-remarks">{only?.remarks ?? ""}</td>
                    </>
                  )}
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6 + providers.length} className="muted" style={{ padding: "0.8rem" }}>
                  No payer lines match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <form ref={popoverRef} className="scell-editor" style={popoverStyle} onSubmit={submit}>
          <strong>
            {editing.kind === "cell"
              ? editing.provider.name
              : editing.field === "groupStatus"
                ? "Group status"
                : editing.field === "ediStatus"
                  ? "EDI / ERA"
                  : "EFT"}
          </strong>
          <span className="muted">
            {editing.row.payer} · {editing.row.segment}
          </span>
          <label>
            Status
            <select name="status" defaultValue={currentStatus} autoFocus>
              {Object.entries(statusOptions).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {(editing.kind === "cell" || editing.field === "groupStatus") && (
            <>
              <label>
                Effective date
                <input
                  name="effectiveDate"
                  type="date"
                  defaultValue={
                    (editing.kind === "cell" ? editing.cell.effectiveDate : editing.row.groupEffectiveDate)?.slice(0, 10) ?? ""
                  }
                />
              </label>
              <label>
                {editing.kind === "cell" ? "Payer provider number" : "Group number with this payer"}
                <input
                  name="number"
                  maxLength={60}
                  defaultValue={(editing.kind === "cell" ? editing.cell.payerProviderId : editing.row.groupNumber) ?? ""}
                  placeholder="PTAN, provider ID…"
                />
              </label>
              <label>
                Remarks
                <textarea
                  name="remarks"
                  rows={2}
                  defaultValue={(editing.kind === "cell" ? editing.cell.remarks : editing.row.groupRemarks) ?? ""}
                  placeholder="DEA required, rep name, ref #…"
                />
              </label>
            </>
          )}
          {error && <p className="login-error">{error}</p>}
          <div className="scell-editor-actions">
            <button className="btn" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button className="btn secondary" type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
            {editing.kind === "cell" && enrollmentBasePath && (
              <a className="btn ghost" href={`${enrollmentBasePath}${editing.cell.id}`}>
                Full record
              </a>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
