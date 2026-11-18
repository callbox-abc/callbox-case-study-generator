/** @type {import('next').NextConfig} */
const nextConfig = {
  // Shown in the editor's developer keynote: the build date and the commit the build came from.
  env: {
    NEXT_PUBLIC_APP_BUILD_DATE: new Date().toISOString().slice(0, 10),
    NEXT_PUBLIC_APP_COMMIT: (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7),
  },
};

module.exports = nextConfig;
