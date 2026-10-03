import qrcode from "qrcode-generator";

// Built on the phone: works offline and the customer's name / UPI never leave the device.
function make(text: string) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr;
}

/** Dark runs of each row as [start, length] pairs, for drawing with plain views. */
export function qrRows(text: string): { size: number; rows: [number, number][][] } {
  const qr = make(text);
  const size = qr.getModuleCount();
  const rows: [number, number][][] = [];
  for (let r = 0; r < size; r++) {
    const runs: [number, number][] = [];
    let start = -1;
    for (let c = 0; c <= size; c++) {
      const dark = c < size && qr.isDark(r, c);
      if (dark && start < 0) start = c;
      if (!dark && start >= 0) {
        runs.push([start, c - start]);
        start = -1;
      }
    }
    rows.push(runs);
  }
  return { size, rows };
}

/** Inline SVG for printed bills / PDFs. */
export function qrSvg(text: string, px: number): string {
  const qr = make(text);
  const size = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="-2 -2 ${size + 4} ${size + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${size + 4}" height="${size + 4}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export function upiLink(upi: string, name: string, amount?: number, note?: string): string {
  const parts = [`pa=${encodeURIComponent(upi.trim())}`, `pn=${encodeURIComponent(name)}`];
  if (amount && amount > 0) parts.push(`am=${amount}`);
  parts.push("cu=INR");
  if (note) parts.push(`tn=${encodeURIComponent(note)}`);
  return `upi://pay?${parts.join("&")}`;
}
