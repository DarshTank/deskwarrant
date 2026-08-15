import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only. Next blocks cross-origin requests to dev assets unless the origin
  // is listed here. 172.29.224.1 is this machine's WSL virtual adapter;
  // 192.168.1.18 is its Wi-Fi address, needed to open the console from a phone
  // on the same network (Stage 7's push checkpoint has to run off localhost).
  //
  // Has no effect on a production build.
  allowedDevOrigins: ["172.29.224.1", "192.168.1.18"],
};

export default nextConfig;
