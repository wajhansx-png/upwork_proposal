import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/**
 * Next 16 only trusts `localhost` for dev resources like the HMR socket. When the
 * app is opened at 127.0.0.1 or over the LAN (containers, phones, preview tunnels)
 * the dev client is blocked, and without it the page never hydrates — every button
 * silently does nothing. Trusting this machine's own addresses keeps dev usable.
 */
const localAddresses = Object.values(networkInterfaces())
  .flat()
  .flatMap((iface) => (iface?.address ? [iface.address] : []));

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1", "[::1]", ...localAddresses],
};

export default nextConfig;
