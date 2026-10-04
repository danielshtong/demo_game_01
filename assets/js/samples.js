function ascii(value) {
  return String(value)
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export function buildPdf(pages) {
  const objects = [];
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const kids = [];
  let number = 4;
  for (const page of pages) {
    const contentNumber = number++;
    const pageNumber = number++;
    const lines = [
      '0.839 1.000 0.290 rg',
      '0 548 792 64 re f',
      '0.078 0.086 0.047 rg',
      `BT /F1 16 Tf 56 572 Td (${ascii(page.kicker || 'Lumina')}) Tj ET`,
      '0 0 0 rg',
    ];
    page.lines.forEach((line, index) => {
      lines.push(`BT /F1 30 Tf 56 ${460 - index * 58} Td (${ascii(line)}) Tj ET`);
    });
    const stream = lines.join('\n');
    objects[contentNumber] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects[pageNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Contents ${contentNumber} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    kids.push(`${pageNumber} 0 R`);
  }
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = pdf.length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load('500 120px Fraunces'),
      document.fonts.load('600 28px Outfit'),
    ]);
  } catch {
    /* System fonts still draw the posters. */
  }
  await document.fonts.ready;
}

function canvasBlob(draw) {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  draw(canvas.getContext('2d'), canvas);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9));
}

function drawWelcome(ctx) {
  ctx.fillStyle = '#12150f';
  ctx.fillRect(0, 0, 1920, 1080);
  const glow = ctx.createRadialGradient(1500, 520, 40, 1500, 520, 620);
  glow.addColorStop(0, 'rgba(214, 255, 74, 0.95)');
  glow.addColorStop(1, 'rgba(214, 255, 74, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1920, 1080);
  ctx.strokeStyle = 'rgba(214, 255, 74, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(1500, 540, 250, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#d6ff4a';
  ctx.font = '600 28px Outfit, sans-serif';
  ctx.fillText('LUMINA', 140, 250);
  ctx.fillStyle = '#f4f0e6';
  ctx.font = '500 132px Fraunces, Georgia, serif';
  ctx.fillText('Welcome in.', 140, 430);
  ctx.font = '400 40px Outfit, sans-serif';
  ctx.fillStyle = 'rgba(244, 240, 230, 0.78)';
  ctx.fillText('Images, pages, and film, playing in order.', 140, 520);
}

function drawLunch(ctx) {
  ctx.fillStyle = '#f3ecdf';
  ctx.fillRect(0, 0, 1920, 1080);
  ctx.fillStyle = '#12150f';
  ctx.fillRect(0, 0, 36, 1080);
  ctx.fillStyle = '#d6ff4a';
  roundedRect(ctx, 140, 150, 210, 46, 23);
  ctx.fill();
  ctx.fillStyle = '#12150f';
  ctx.font = '600 22px Outfit, sans-serif';
  ctx.fillText('SERVICE', 188, 181);
  ctx.fillStyle = '#12150f';
  ctx.font = '500 120px Fraunces, Georgia, serif';
  ctx.fillText('Lunch', 140, 390);
  ctx.font = '500 64px Fraunces, Georgia, serif';
  ctx.fillText('12:00 – 14:30', 140, 490);
  ctx.font = '400 42px Outfit, sans-serif';
  const items = ['Citrus salad', 'Roasted mushroom rice', 'Iced barley tea'];
  items.forEach((item, index) => {
    const y = 680 + index * 90;
    ctx.fillStyle = '#d6ff4a';
    ctx.beginPath();
    ctx.arc(160, y - 14, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#12150f';
    ctx.fillText(item, 200, y);
  });
}

export async function createSampleMedia() {
  await ensureFonts();
  const welcome = await canvasBlob(drawWelcome);
  const lunch = await canvasBlob(drawLunch);
  const pdf = buildPdf([
    {
      kicker: 'Lumina | Counter',
      lines: ['Today at the counter', 'Pour-over coffee', 'Citrus salad', 'Butter croissant'],
    },
    {
      kicker: 'Lumina | Hours',
      lines: ['Open daily', '8:00 to 18:00', 'Samples stay in this browser', 'Delete them anytime'],
    },
  ]);
  const media = [
    { name: 'Welcome.jpg', kind: 'image', mime: 'image/jpeg', blob: welcome },
    { name: 'Lunch service.jpg', kind: 'image', mime: 'image/jpeg', blob: lunch },
    { name: 'Counter menu.pdf', kind: 'pdf', mime: 'application/pdf', blob: pdf },
  ];
  try {
    const response = await fetch('assets/samples/spot.mp4');
    if (response.ok) {
      const blob = await response.blob();
      if (blob.size > 800) {
        media.splice(2, 0, { name: 'Afternoon spot.mp4', kind: 'video', mime: 'video/mp4', blob });
      }
    }
  } catch {
    /* The image and PDF samples still show the playlist. */
  }
  return media;
}
