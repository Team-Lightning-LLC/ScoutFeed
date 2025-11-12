/* ===== Parse (Structured Articles + Bullet Detection + Cleanup) ===== */
parseDigest(raw) {
  // Clean stray formatting characters and soft hyphens
  let text = raw
    .replace(/\r/g, '')
    .replace(/\u00AD/g, '')
    .replace(/^#+\s*/gm, '')       // remove markdown headers
    .replace(/#+(?=\s|$)/g, '')    // remove rogue trailing hashes
    .replace(/###+/g, '')          // remove isolated ###
    .trim();

  const articleBlocks = text.split(/(?=Article\s+\d+)/gi).map(b => b.trim()).filter(Boolean);
  const cards = [];

  for (const block of articleBlocks) {
    const titleMatch = block.match(/Article\s+\d+\s*[-–:]\s*(.+)/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Untitled Article';

    // Extract "Contents" section
    const contentsMatch = block.match(/Contents\s*\d*[\s\S]*?(?=(Citations|Article\s+\d+|$))/i);
    let contents = contentsMatch
      ? contentsMatch[0].replace(/Contents\s*\d*/i, '').trim()
      : '';

    // --- 🟦 Convert inline bullets (- **Header:** ...) into clean <li> items ---
    const bulletLines = contents
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const formatted = [];
    for (const line of bulletLines) {
      if (/^[-•*]\s*\*\*.+?:/.test(line)) {
        formatted.push(`<li>${this.formatMarkdown(line.replace(/^[-•*]\s*/, '').trim())}</li>`);
      } else if (/^[-•*]\s+/.test(line)) {
        formatted.push(`<li>${this.formatMarkdown(line.replace(/^[-•*]\s*/, '').trim())}</li>`);
      } else {
        formatted.push(`<p>${this.formatMarkdown(line)}</p>`);
      }
    }

    contents = `<ul class="article-contents">${formatted.join('')}</ul>`;

    // --- Citations ---
    const citations = [];
    const citationsMatch = block.match(/Citations\s*\d*[\s\S]*?(?=(Article\s+\d+|$))/i);
    if (citationsMatch) {
      const lines = citationsMatch[0]
        .replace(/Citations\s*\d*/i, '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        const url = (line.match(/\((https?:\/\/[^\s)]+)\)/) || [])[1];
        const text = line.replace(/\[|\]/g, '').replace(/\(https?:\/\/[^\s)]+\)/, '').trim();
        if (url) citations.push({ title: text || 'Source', url });
      }
    }

    cards.push({ title, contents, citations });
  }

  const docTitle =
    text.match(/^#?\s*Scout Pulse Portfolio Digest.*$/m)?.[0]?.replace(/^#\s*/, '').trim() ||
    'Portfolio Digest';

  return { title: docTitle, cards };
}
