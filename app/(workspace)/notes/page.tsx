import { redirect } from "next/navigation";

/** Notes became the Marketing ideas page. Old links keep working. */
export default function NotesPage() {
  redirect("/marketing");
}
