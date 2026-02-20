export function parseHeight(text) {
  if (!text) return { meters: null, feet: null };

  const t = text.toLowerCase().replace(/,/g, ".").trim();

  // 1) metros: "14m", "14 m", "14 metros"
  let m = t.match(/(\d+(\.\d+)?)\s*(m|metro|metros)\b/);
  if (m) {
    const meters = Number(m[1]);
    if (Number.isFinite(meters) && meters > 0 && meters < 60) {
      const feet = Math.round(meters / 0.3048);
      return { meters: round1(meters), feet };
    }
  }

  // 2) pies: "40ft", "40 ft", "40 pies"
  let f = t.match(/(\d+)\s*(ft|pies|pie)\b/);
  if (f) {
    const feet = Number(f[1]);
    if (Number.isFinite(feet) && feet > 0 && feet < 200) {
      const meters = feet * 0.3048;
      return { meters: round1(meters), feet };
    }
  }

  // 3) número suelto (por ahora lo tratamos como metros si <= 25, si no como pies)
  let n = t.match(/^\s*(\d+(\.\d+)?)\s*$/);
  if (n) {
    const val = Number(n[1]);
    if (val > 0 && val < 200) {
      if (val <= 25) {
        const meters = val;
        const feet = Math.round(meters / 0.3048);
        return { meters: round1(meters), feet };
      } else {
        const feet = Math.round(val);
        const meters = feet * 0.3048;
        return { meters: round1(meters), feet };
      }
    }
  }

  return { meters: null, feet: null };
}

function round1(x) {
  return Math.round(x * 10) / 10;
}
