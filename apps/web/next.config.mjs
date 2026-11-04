/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@preconteo/shared'],
  // Estos paquetes viven solo en el proceso Node del servidor propio (server.js);
  // nunca se empaquetan en el bundle de rutas.
  serverExternalPackages: ['ioredis', 'ws', 'bcryptjs', 'pino', '@supabase/supabase-js'],
};

export default nextConfig;
