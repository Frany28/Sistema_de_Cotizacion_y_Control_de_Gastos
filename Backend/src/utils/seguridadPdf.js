import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const ORIGENES_PDF_PERMITIDOS = new Set(["https://cdn.tailwindcss.com"]);

const escaparHtml = (valor) =>
  valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const sanitizarDatosPdf = (valor, profundidad = 0) => {
  if (profundidad > 12) return null;
  if (typeof valor === "string") return escaparHtml(valor);
  if (Array.isArray(valor)) {
    return valor.map((dato) => sanitizarDatosPdf(dato, profundidad + 1));
  }

  if (valor && typeof valor === "object" && !(valor instanceof Date)) {
    return Object.fromEntries(
      Object.entries(valor).map(([clave, dato]) => [
        clave,
        sanitizarDatosPdf(dato, profundidad + 1),
      ]),
    );
  }

  return valor;
};

export const protegerPaginaPdf = async (page) => {
  await page.setRequestInterception(true);

  page.on("request", (request) => {
    const url = request.url();

    if (
      url === "about:blank" ||
      url.startsWith("data:") ||
      url.startsWith("blob:")
    ) {
      request.continue();
      return;
    }

    try {
      const destino = new URL(url);
      if (ORIGENES_PDF_PERMITIDOS.has(destino.origin)) {
        request.continue();
        return;
      }
    } catch {
      // Una URL no valida nunca debe salir del proceso que genera el PDF.
    }

    request.abort("blockedbyclient");
  });
};

export const generarPdfSeguro = async (html, opcionesPdf) => {
  let browser;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await protegerPaginaPdf(page);
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
    return await page.pdf(opcionesPdf);
  } finally {
    if (browser) await browser.close();
  }
};
