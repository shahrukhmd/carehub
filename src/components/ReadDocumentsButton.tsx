"use client";

import { useFormStatus } from "react-dom";

// Submits the form to the document reader without validating the (still empty) patient fields.
// Reading scanned pages takes a while, so the button says what is happening.
export function ReadDocumentsButton({ action, label }: { action: (formData: FormData) => Promise<void>; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" formAction={action} formNoValidate disabled={pending}>
      {pending ? "Reading documents… this can take a minute" : label}
    </button>
  );
}
