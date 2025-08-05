export function clampTags (tags = [], max = 33) {
  return Array.from(
    new Set(
      tags.map(t => String(t).trim().toLowerCase()).filter(Boolean)
    )
  ).slice(0, max);
}
