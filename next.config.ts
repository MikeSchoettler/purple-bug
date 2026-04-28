import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'fluent-ffmpeg',
    'ffmpeg-static',
    'ffprobe',
    '@ffprobe-installer/ffprobe',
    'sharp',
    'archiver',
  ],
};

export default nextConfig;
