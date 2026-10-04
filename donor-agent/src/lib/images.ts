import { createHash, randomBytes } from "node:crypto";
import { kvSetImage } from "./db";

const MAX_BYTES = 450_000;

export interface Saved {
  id: string;
  hash: string;
  dataUrl: string;
}

/** Checks and stores a screenshot sent as a data URL (the browser shrinks it first). */
export async function saveImage(dataUrl: unknown): Promise<Saved> {
  if (typeof dataUrl !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl))
    throw new Error("That is not a valid image.");
  if (dataUrl.length > MAX_BYTES * 1.4) throw new Error("The image is too big. Try a smaller screenshot.");
  const hash = createHash("sha256").update(dataUrl.slice(dataUrl.indexOf(",") + 1)).digest("hex").slice(0, 32);
  const id = randomBytes(8).toString("hex");
  await kvSetImage(id, dataUrl);
  return { id, hash, dataUrl };
}
