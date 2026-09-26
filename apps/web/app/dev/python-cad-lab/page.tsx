import { notFound } from "next/navigation";
import { PythonCadLab } from "@/components/dev/python-cad-lab";

export default function PythonCadLabPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PythonCadLab />;
}
