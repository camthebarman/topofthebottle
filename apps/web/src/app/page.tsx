import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";

export default async function Home() {
  redirect((await getUser()) ? "/today" : "/sign-in");
}
