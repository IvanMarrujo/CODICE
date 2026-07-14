// ============================================================
// CÓDICE · PDF helper
// Renderiza HTML -> PDF con Puppeteer. Usado por /contracts/:id/pdf
// y /courses/:courseId/constancia/:employeeId.
// ============================================================

import puppeteer from 'puppeteer'

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({
      format:          'letter',
      printBackground: true,
      margin:          { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
