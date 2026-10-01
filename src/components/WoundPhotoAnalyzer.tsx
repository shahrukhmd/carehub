"use client";

import { useRef, useState, useTransition } from "react";
import { analysisNote, changeText, scaleLabel, trendLabel, type WoundAnalysis } from "@/lib/wound-analysis";

type Result = { analysis: WoundAnalysis } | { error: string };

const MAX_SIDE = 1600;

// Photos straight from a phone are several megabytes; a 1600 px JPEG keeps the ruler markings readable.
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

const fmt = (n: number | null, unit: string) => (n === null ? "—" : `${Math.round(n * 10) / 10} ${unit}`);

// Wound photo field for the assessment form, with "Analyze photo": the AI measures the wound from the ruler in the
// photo, estimates the tissue mix and compares it with the previous photo. The clinician reviews the reading and
// chooses whether to fill the form with it; the photo itself is saved with the assessment as before.
export function WoundPhotoAnalyzer({ action }: { action: (photo: string) => Promise<Result> }) {
  const root = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [filled, setFilled] = useState(false);
  const [pending, start] = useTransition();

  const onFile = async (file: File | undefined) => {
    setResult(null);
    setFilled(false);
    setPreview(file ? await shrink(file).catch(() => null) : null);
  };

  const fill = (a: WoundAnalysis) => {
    const form = root.current?.closest("form");
    if (!form) return;
    const set = (name: string, value: number | string | null) => {
      const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
      if (!el || value === null || value === "") return;
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const r = a.reading;
    set("lengthCm", r.lengthCm === null ? null : Math.round(r.lengthCm * 10) / 10);
    set("widthCm", r.widthCm === null ? null : Math.round(r.widthCm * 10) / 10);
    set("granulationPct", r.granulationPct);
    set("sloughPct", r.sloughPct);
    set("escharPct", r.escharPct);
    set("epithelialPct", r.epithelialPct);
    set("periwoundSkin", r.periwound);
    const notes = form.querySelector<HTMLTextAreaElement>('textarea[name="notes"]');
    if (notes) notes.value = [notes.value.trim(), analysisNote(a)].filter(Boolean).join("\n\n");
    setFilled(true);
  };

  const a = result && "analysis" in result ? result.analysis : null;
  const change = a ? changeText(a.areaChangePct) : null;

  return (
    <div className="wpa" ref={root}>
      <label>
        Wound photo (include a ruler or measurement sticker next to the wound)
        <input name="photo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>

      {preview && (
        <div className="wpa-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="wpa-thumb" src={preview} alt="Wound photo selected for this assessment" />
          <div className="wpa-side">
            <button type="button" className="ai-assist-btn" disabled={pending} onClick={() => start(async () => setResult(await action(preview)))}>
              ✦ {pending ? "Analyzing photo…" : result ? "Analyze again" : "Analyze photo"}
            </button>
            <span className="ai-assist-note">Measures length and width from the ruler, estimates the tissue mix, and compares with the previous photo.</span>
            {result && "error" in result && <p className="ai-assist-error">{result.error}</p>}
          </div>
        </div>
      )}

      {a && (
        <div className="ai-assist-result wpa-result">
          {!a.reading.woundVisible ? (
            <p className="ai-assist-error">No wound could be seen in this photo.</p>
          ) : (
            <>
              <div className="wpa-metrics">
                <div>
                  <span>Length × width</span>
                  <strong>{a.reading.lengthCm !== null && a.reading.widthCm !== null ? `${fmt(a.reading.lengthCm, "")}× ${fmt(a.reading.widthCm, "cm")}` : "Not measured"}</strong>
                </div>
                <div>
                  <span>Area</span>
                  <strong>{fmt(a.areaCm2, "cm²")}</strong>
                </div>
                <div>
                  <span>Scale used</span>
                  <strong>
                    {scaleLabel[a.reading.scaleReference]}
                    {a.reading.scaleReference !== "NONE" ? ` · ${a.reading.measurementConfidence} confidence` : ""}
                  </strong>
                </div>
                <div>
                  <span>Tissue</span>
                  <strong>
                    {[
                      a.reading.granulationPct !== null ? `granulation ${a.reading.granulationPct}%` : "",
                      a.reading.sloughPct !== null ? `slough ${a.reading.sloughPct}%` : "",
                      a.reading.escharPct !== null ? `eschar ${a.reading.escharPct}%` : "",
                      a.reading.epithelialPct !== null ? `epithelial ${a.reading.epithelialPct}%` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Not assessed"}
                  </strong>
                </div>
              </div>
              {a.reading.scaleReference === "NONE" && (
                <p className="ai-assist-error">No ruler or measurement sticker was found, so the size was not measured. Retake the photo with a ruler beside the wound, or type the measurements.</p>
              )}
              <p>{a.reading.observations}</p>
              {a.reading.periwound && <p className="muted">Periwound: {a.reading.periwound}</p>}

              {a.previous && (
                <div className="wpa-compare">
                  <div className="wpa-compare-head">
                    <strong>Compared with {a.previous.date}</strong>
                    {change && <span className={`gw-tag gw-tag-${a.areaChangePct! < 0 ? "ok" : a.areaChangePct! > 0 ? "bad" : "muted"}`}>Area {change}</span>}
                    {a.reading.comparison && (
                      <span className={`gw-tag gw-tag-${a.reading.comparison.trend === "IMPROVING" ? "ok" : a.reading.comparison.trend === "WORSENING" ? "bad" : "muted"}`}>
                        {trendLabel[a.reading.comparison.trend]}
                      </span>
                    )}
                  </div>
                  <div className="wpa-photos">
                    {a.previous.photoUrl && (
                      <figure>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.previous.photoUrl} alt={`Wound photo from ${a.previous.date}`} />
                        <figcaption>
                          {a.previous.date} · {a.previous.lengthCm ?? "—"} × {a.previous.widthCm ?? "—"} cm · {fmt(a.previous.areaCm2, "cm²")}
                        </figcaption>
                      </figure>
                    )}
                    <figure>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview!} alt="Today's wound photo" />
                      <figcaption>
                        Today · {fmt(a.reading.lengthCm, "")}× {fmt(a.reading.widthCm, "cm")} · {fmt(a.areaCm2, "cm²")}
                      </figcaption>
                    </figure>
                  </div>
                  {a.reading.comparison && <p>{a.reading.comparison.summary}</p>}
                  {!a.previous.photoUrl && <p className="muted">The previous assessment has no photo, so only the recorded measurements are compared.</p>}
                </div>
              )}

              <div className="gw-actions">
                <button type="button" className="btn secondary" onClick={() => fill(a)}>
                  {filled ? "Form filled ✓ — fill again" : "Fill the assessment with this reading"}
                </button>
                <button type="button" className="btn ghost" onClick={() => setResult(null)}>
                  Discard
                </button>
              </div>
            </>
          )}
          <span className="ai-assist-note">
            Read by AI ({a.provider}) from the photo. Check the measurements against the wound before saving; depth, tunneling and undermining must be measured by hand.
          </span>
        </div>
      )}
    </div>
  );
}
