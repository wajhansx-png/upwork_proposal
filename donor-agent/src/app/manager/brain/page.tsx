import { redirect } from "next/navigation";

/** The Case Brain now lives on the Case page. */
export default function ManagerBrainPage() {
  redirect("/manager/case");
}
