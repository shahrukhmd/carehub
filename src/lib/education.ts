import "server-only";

// Patient education lookup. MedlinePlus Connect (National Library of Medicine) is free and needs no key: it
// returns plain-language material for an ICD-10 code in English or Spanish. The provider sits behind one
// function so a licensed content vendor can replace it later.

export type EducationHit = { title: string; url: string; summary: string | null; source: string; language: string };

const ICD10_OID = "2.16.840.1.113883.6.90";

export async function lookupEducation(icd10: string, language: "en" | "es" = "en"): Promise<EducationHit[]> {
  const code = icd10.trim().toUpperCase();
  if (!/^[A-Z][0-9][0-9A-Z](\.?[0-9A-Z]{1,4})?$/.test(code)) return [];
  const u = new URL("https://connect.medlineplus.gov/service");
  u.searchParams.set("mainSearchCriteria.v.cs", ICD10_OID);
  u.searchParams.set("mainSearchCriteria.v.c", code);
  u.searchParams.set("knowledgeResponseType", "application/json");
  u.searchParams.set("informationRecipient.languageCode.c", language);
  try {
    const res = await fetch(u, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000), next: { revalidate: 86_400 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { feed?: { entry?: { title?: { _value?: string }; link?: { href?: string }[]; summary?: { _value?: string } }[] } };
    return (json.feed?.entry ?? [])
      .map((e) => ({ title: e.title?._value ?? "", url: e.link?.[0]?.href ?? "", summary: e.summary?._value ? e.summary._value.replace(/<[^>]+>/g, "").trim().slice(0, 400) : null, source: "MedlinePlus", language }))
      .filter((h) => h.title && h.url)
      .slice(0, 6);
  } catch {
    return [];
  }
}
