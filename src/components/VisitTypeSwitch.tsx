"use client";

import { useState, type ReactNode } from "react";

type VisitTypeOption = { code: string; name: string; durationMin: number | null; billable: boolean };

// The encounter-type picker at the top of "Schedule encounter". Most types book through the standard form; the
// telehealth type swaps the whole form for the telehealth booking panel (doctor windows and 20-minute blocks).
export function VisitTypeSwitch({
  types,
  defaultValue,
  telehealthCode,
  standardAction,
  standard,
  telehealth,
}: {
  types: VisitTypeOption[];
  defaultValue: string;
  telehealthCode: string;
  standardAction: (formData: FormData) => void | Promise<void>;
  standard: ReactNode;
  telehealth: ReactNode;
}) {
  const [value, setValue] = useState(defaultValue);
  const isTelehealth = value === telehealthCode;
  const select = (
    <label>
      Encounter type
      <select name={isTelehealth ? undefined : "visitType"} value={value} onChange={(e) => setValue(e.target.value)}>
        {types
          .filter((t) => t.billable)
          .map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
              {t.durationMin ? ` (${t.durationMin} min)` : ""}
            </option>
          ))}
        {types.some((t) => !t.billable) && (
          <optgroup label="Non-billable interactions">
            {types
              .filter((t) => !t.billable)
              .map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
          </optgroup>
        )}
      </select>
    </label>
  );

  if (isTelehealth) {
    return (
      <div className="stack">
        {select}
        {telehealth}
      </div>
    );
  }
  return (
    <form className="stack" action={standardAction}>
      {select}
      {standard}
    </form>
  );
}
