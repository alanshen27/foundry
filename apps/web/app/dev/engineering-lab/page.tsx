import { notFound } from "next/navigation";
import { EngineeringLab } from "@/components/dev/engineering-lab";

export const dynamic = "force-dynamic";

/** In-memory UI fixture: never available in production and never calls a database. */
export default function EngineeringLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <EngineeringLab />;
}
