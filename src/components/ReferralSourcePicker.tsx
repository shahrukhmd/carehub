"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ProviderForm } from "@/components/ProviderForm";

type Option = { id: string; name: string };
type LookupResult = {
  match?: { npi: string; name: string; credential: string | null; taxonomy: string | null; address: string | null };
  error?: string;
};

const NEW = "__new";
const TYPED = "__typed";

// "Referring physician / source" on a gateway case: one list of the practice's referring physicians and referring
// companies / groups. Picking one sets the patient's referring physician and the case's source name together. The
// last option adds a new one in a popup (always as a referring provider) and selects it. A source name typed before
// the list existed stays available as its own option until something from the list replaces it.
export function ReferralSourcePicker({
  options: initialOptions,
  currentId,
  currentName,
  addReferrer,
  lookupNpi,
  bdOwners,
}: {
  options: Option[];
  currentId: string | null;
  currentName: string | null;
  addReferrer: (fd: FormData) => Promise<{ provider?: Option; error?: string }>;
  lookupNpi: (npi: string) => Promise<LookupResult>;
  bdOwners: Option[];
}) {
  const [options, setOptions] = useState(initialOptions);
  const typedName = currentName && !initialOptions.some((o) => o.id === currentId && o.name === currentName) ? currentName : null;
  const [selected, setSelected] = useState(currentId && initialOptions.some((o) => o.id === currentId) ? currentId : typedName ? TYPED : "");
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // The popup's form can't sit inside the case's own form, so it is rendered at the end of the page.
  useEffect(() => setMounted(true), []);

  const picked = options.find((o) => o.id === selected) ?? null;
  const close = () => dialogRef.current?.close();

  return (
    <>
      <label>
        <span>
          Referring physician / source <span className="req">*</span>
        </span>
        <select
          value={selected}
          onChange={(e) => {
            if (e.target.value === NEW) {
              setError(null);
              setFormKey((k) => k + 1);
              dialogRef.current?.showModal();
              return;
            }
            setSelected(e.target.value);
          }}
        >
          <option value="">—</option>
          {typedName && <option value={TYPED}>{typedName} (typed earlier, not in the list)</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value={NEW}>+ Add new referring physician / source…</option>
        </select>
        <input type="hidden" name="referringPhysicianId" value={picked?.id ?? ""} />
        <input type="hidden" name="referralSourceName" value={picked?.name ?? (selected === TYPED ? (typedName ?? "") : "")} />
      </label>

      {mounted &&
        createPortal(
          <dialog
            ref={dialogRef}
            className="form-dialog form-dialog-wide"
            aria-label="Add referring physician / source"
            onClick={(e) => {
              if (e.target === dialogRef.current) close();
            }}
          >
            <div className="form-dialog-head">
              <div>
                <h2>Add referring physician / source</h2>
                <p className="muted">It is added to the provider directory and picked for this referral.</p>
              </div>
              <button type="button" className="popover-close" aria-label="Close" onClick={close}>
                ×
              </button>
            </div>
            {error && <p className="login-error">{error}</p>}
            <ProviderForm
              key={formKey}
              lockedReferring
              action={async (fd) => {
                const res = await addReferrer(fd);
                if (!res.provider) {
                  setError(res.error ?? "Could not add the referring physician / source");
                  return;
                }
                const added = res.provider;
                setOptions((list) => [...list.filter((o) => o.id !== added.id), added].sort((a, b) => a.name.localeCompare(b.name)));
                setSelected(added.id);
                close();
              }}
              lookupNpi={lookupNpi}
              users={[]}
              supervisors={[]}
              groupNames={[]}
              bdOwners={bdOwners}
              submitLabel="Add and select"
              onCancel={close}
            />
          </dialog>,
          document.body
        )}
    </>
  );
}
