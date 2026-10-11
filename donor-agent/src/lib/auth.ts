import type { NextRequest } from "next/server";
import type { Role } from "./types";

/**
 * Who is calling. Both pages are public links: each page says who it is with the x-as header
 * (/manager sends "manager", /areeba and her phone alerts send "teammate"). There is no sign-in.
 * Anything without the header is treated as the teammate, the page with fewer rights.
 */
export async function getRole(req: NextRequest): Promise<Role | null> {
  return req.headers.get("x-as") === "manager" ? "manager" : "teammate";
}
