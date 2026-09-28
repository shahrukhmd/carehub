import { redirect } from "next/navigation";

// The patient registry lives in the Patient Gateway.
export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  redirect(`/?tab=registry${q ? `&q=${encodeURIComponent(q)}` : ""}`);
}
