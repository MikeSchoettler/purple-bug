import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/**': [
      './public/assets/fonts/**',
      './public/assets/plates/**',
      './public/assets/logoshots/**',
    ],
  },
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
