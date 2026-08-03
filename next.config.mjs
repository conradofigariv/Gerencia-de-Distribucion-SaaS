/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: process.cwd(),
  },
  // pdfjs resuelve su worker por ruta en disco. Si el bundler lo empaqueta, esa
  // ruta apunta a los chunks generados y la carga falla; dejándolo externo
  // resuelve contra node_modules como espera.
  serverExternalPackages: ["pdfjs-dist"],
}

export default nextConfig
