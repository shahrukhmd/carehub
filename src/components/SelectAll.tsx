"use client";

import { useEffect, useRef, useState } from "react";

// "Select all" for the checkboxes called `name` in the surrounding form, with a running count. max: the most
// that may be ticked at once (the count turns into a warning beyond it).
export function SelectAll({ name, max, noun = "claim" }: { name: string; max?: number; noun?: string }) {
  const box = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);

  const boxes = () => [...(box.current?.form?.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]:not(:disabled)`) ?? [])];

  useEffect(() => {
    const form = box.current?.form;
    if (!form) return;
    const sync = () => {
      const all = boxes();
      setTotal(all.length);
      setCount(all.filter((b) => b.checked).length);
    };
    sync();
    form.addEventListener("change", sync);
    return () => form.removeEventListener("change", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const toggle = (on: boolean) => {
    const all = boxes();
    all.forEach((b, i) => (b.checked = on && (!max || i < max)));
    setCount(all.filter((b) => b.checked).length);
  };

  const over = Boolean(max && count > max);
  return (
    <span className="sel-all">
      <label>
        <input ref={box} type="checkbox" checked={total > 0 && count === Math.min(total, max ?? total)} disabled={total === 0} onChange={(e) => toggle(e.target.checked)} />
        Select all{max && total > max ? ` (first ${max})` : ""}
      </label>
      <strong className={over ? "cd-bad" : undefined}>
        {count} of {total} {noun}
        {total === 1 ? "" : "s"} selected{over ? ` — the limit is ${max}` : ""}
      </strong>
    </span>
  );
}
