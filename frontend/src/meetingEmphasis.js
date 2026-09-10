// Explicit author annotations only: never infer responsibility from company mentions.
export function meetingLine(value) {
  let text = String(value ?? "");
  const bullet = text.match(/^\s*[•·-]\s*/)?.[0] || "";
  text = text.slice(bullet.length);
  const important = text.startsWith("[중요]");
  if (important) text = text.slice(4).trimStart();
  const owner = text.match(/^(포켓(?:컴퍼니)?|NS)(?:\s*[·/&+]\s*(포켓(?:컴퍼니)?|NS))?\s*[:：]\s*/i);
  const owners = owner ? [...new Set([owner[1], owner[2]].filter(Boolean).map(name => /^ns$/i.test(name) ? "ns" : "pocket"))] : [];
  if (owner) text = text.slice(owner[0].length);
  const tone = important ? "important" : owners.length === 1 ? owners[0] : "plain";
  return { text, bullet, important, owners, tone };
}
