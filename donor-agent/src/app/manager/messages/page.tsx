import { redirect } from "next/navigation";

/** Saved messages now live inside Cases ("Messages for Areeba"). */
export default function ManagerMessagesPage() {
  redirect("/manager/case?view=messages");
}
