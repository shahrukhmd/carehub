import { redirect } from "next/navigation";

// There is no separate patient list: patients are found with "Search patients" in the side menu, and this address
// (used as a back link) goes to the Patient Gateway.
export default async function PatientsPage() {
  redirect("/");
}
