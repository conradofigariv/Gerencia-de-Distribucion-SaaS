// El build legacy de pdfjs no publica tipos para su entry point de worker;
// solo se importa para registrarlo como `globalThis.pdfjsWorker` (ver
// `registrarWorkerDePdfjs` en parse-consumo-pdf.ts), así que un módulo `any`
// alcanza.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
