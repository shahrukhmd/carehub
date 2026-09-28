"use client";

import { useEffect, useRef, useState } from "react";

// Draw (mouse, touch or stylus) or upload a signature; the PNG data URL goes into a hidden form field.
export function SignaturePad({ name, initial }: { name: string; initial?: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [value, setValue] = useState(initial ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111b4a";
    if (initial) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = initial;
    }
  }, [initial]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * canvas.width, y: ((e.clientY - rect.top) / rect.height) * canvas.height };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some pointer sources can't be captured; drawing still works.
    }
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setDirty(true);
    setValue(canvasRef.current!.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setValue("");
    setDirty(true);
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        setValue(canvas.toDataURL("image/png"));
        setDirty(true);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="sig-pad">
      <canvas
        ref={canvasRef}
        width={600}
        height={180}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        aria-label="Signature pad — draw your signature"
      />
      <input type="hidden" name={name} value={value} />
      <div className="sig-pad-tools">
        <button type="button" className="btn ghost gw-mini" onClick={clear}>
          Clear
        </button>
        <label className="btn ghost gw-mini">
          Upload image
          <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        <span className="muted">{dirty ? "Not saved yet" : value ? "Signature on file" : "Sign inside the box"}</span>
      </div>
    </div>
  );
}
