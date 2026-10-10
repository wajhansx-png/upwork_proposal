import { NextRequest, NextResponse } from "next/server";
import { extensionFiles } from "@/lib/extension-files";
import { makeZip } from "@/lib/zip";

/** Download the add-on as a zip. Open to both roles — it holds no secret; the token is pasted separately. */
export function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const zip = makeZip(extensionFiles(origin));
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="givelife-counter.zip"',
      "cache-control": "no-store",
    },
  });
}
