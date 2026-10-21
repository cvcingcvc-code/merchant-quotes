import { readFileSync } from 'node:fs';
import { generate } from '@pdfme/generator';
import { text, rectangle } from '@pdfme/schemas';
import { money, scaledDecimal } from '../public/money.js';

const fontData = readFileSync(new URL('../fonts/NotoSansCJKsc-Regular.otf', import.meta.url));
// CJK characters are one unit; Latin characters use a conservative 0.65 units.
// Explicit wrapping keeps complete long names, addresses, and notes in the PDF.
export function wrap(value, max) {
  const lines = [];
  for (const paragraph of String(value).split('\n')) {
    let line = '', width = 0;
    for (const char of paragraph) {
      const size = char.charCodeAt(0) > 255 ? 1 : 0.65;
      if (width + size > max && line) { lines.push(line); line = ''; width = 0; }
      line += char; width += size;
    }
    lines.push(line);
  }
  return lines;
}

export async function generateQuotePdf(q) {
  const pages = [], inputs = {};
  let page, y, field = 0;
  const drawText = (content, x, top, width, fontSize = 10, color = '#243A3A', align = 'left') => {
    const name = `f${field++}`;
    page.push({ name, type: 'text', position: { x, y: top }, width, height: 9,
      fontName: 'NotoSansCJKsc', fontSize, fontColor: color, alignment: align,
      verticalAlignment: 'top', lineHeight: 1.2, characterSpacing: 0 });
    inputs[name] = String(content);
  };
  const box = (x, top, width, height, color) => page.push({ name: `b${field++}`, type: 'rectangle', position: { x, y: top }, width, height, color, borderColor: color, borderWidth: 0, opacity: 1, radius: 0 });
  const lines = (content, x, top, width, max, size = 9.5) => {
    const rows = wrap(content, max);
    rows.forEach((row, i) => drawText(row, x, top + i * 5.3, width, size));
    return rows.length * 5.3;
  };
  const tableHeader = () => {
    box(16, y, 178, 9, '#EAF3EE');
    [['商品 / 服务', 20, 90], ['数量', 112, 22], ['单价', 137, 25], ['金额（元）', 164, 26]].forEach(([v, x, w]) => drawText(v, x, y + 2, w, 9, '#326452', x > 110 ? 'right' : 'left'));
    y += 13;
  };
  const newPage = (first = false, table = true) => {
    page = []; pages.push(page);
    box(16, 14, 11, 2, '#347B60');
    drawText('报价单', 16, 22, 90, 25);
    drawText('QUOTATION', 130, 24, 64, 10, '#347B60', 'right');
    drawText(q.number, 122, 32, 72, 9, '#6B7C77', 'right');
    y = 47;
    if (first) {
      y += lines(q.title, 16, y, 178, 64, 12) + 6;
      const infoTop = y;
      drawText('报价客户', 16, y, 80, 9, '#6B7C77');
      drawText('报价商家', 108, y, 86, 9, '#6B7C77');
      y += 8;
      let a = y, b = y;
      const c = q.customerSnapshot, m = q.merchantSnapshot;
      for (const value of [c.name, [c.contact, c.phone].filter(Boolean).join(' / '), c.email, c.address].filter(Boolean)) a += lines(value, 16, a, 84, 23) + 1;
      for (const value of [m.name, [m.contact, m.phone].filter(Boolean).join(' / '), m.address].filter(Boolean)) b += lines(value, 108, b, 86, 23) + 1;
      y = Math.max(a, b, infoTop + 22) + 5;
      drawText(`报价日期：${q.quoteDate}`, 16, y, 85, 9);
      drawText(`有效期至：${q.validUntil}`, 108, y, 86, 9);
      y += 12;
    }
    if (table) tableHeader();
  };
  newPage(true);
  q.items.forEach((item, i) => {
    const nameLines = wrap(item.name, 23);
    const unitLines = wrap(item.unit, 7);
    const height = Math.max(15, nameLines.length * 5.3 + 5, 7 + unitLines.length * 4.2);
    if (y + height > 260) newPage();
    nameLines.forEach((value, row) => drawText(`${row === 0 ? `${i + 1}. ` : '   '}${value}`, 20, y + row * 5.3, 88, 9.5));
    drawText(item.quantity, 110, y, 24, 9, '#243A3A', 'right');
    unitLines.forEach((value, row) => drawText(value, 110, y + 5 + row * 4.2, 24, 8, '#65736B', 'right'));
    drawText(money(Number(scaledDecimal(item.unitPrice, 2, '单价'))).replace('¥', ''), 135, y, 27, 9, '#243A3A', 'right');
    drawText(money(item.amountCents).replace('¥', ''), 163, y, 27, 9, '#243A3A', 'right');
    y += height;
    box(16, y - 3, 178, 0.2, '#E4EAE5');
  });
  if (y + 26 > 260) newPage(false, false);
  y += 4;
  box(108, y, 86, 18, '#EAF3EE');
  drawText('合计（人民币）', 112, y + 5, 37, 9, '#326452');
  drawText(money(q.totalCents), 147, y + 4, 43, 15, '#24573F', 'right');
  y += 27;
  for (const [label, content] of [['报价说明', q.notes], ['合作条款', q.merchantSnapshot.terms]]) {
    if (!content) continue;
    if (y + 17 > 260) newPage(false, false);
    drawText(label, 16, y, 178, 10); y += 8;
    for (const row of wrap(content, 54)) {
      if (y + 7 > 260) newPage(false, false);
      drawText(row, 16, y, 178, 9, '#65736B'); y += 5.3;
    }
    y += 5;
  }
  pages.forEach((p, i) => {
    page = p;
    box(16, 274, 178, 0.2, '#DDE6DF');
    drawText(q.merchantSnapshot.name, 16, 278, 130, 8, '#77877D');
    drawText(`第 ${i + 1} / ${pages.length} 页`, 157, 278, 37, 8, '#77877D', 'right');
  });
  return generate({ template: { basePdf: { width: 210, height: 297, padding: [0, 0, 0, 0] }, schemas: pages }, inputs: [inputs],
    plugins: { text, rectangle }, options: { font: { NotoSansCJKsc: { data: fontData, fallback: true, subset: true } } } });
}
