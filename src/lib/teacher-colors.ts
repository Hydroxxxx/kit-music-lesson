export const SUPER_ADMIN_EMAIL = "matthewanders2709@gmail.com";

export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

export interface PastelColorTheme {
  key: string;
  label: string;
  bg: string;
  bgHover: string;
  border: string;
  accent: string;
  text: string;
  subtext: string;
}

export const TEACHER_PASTEL_PALETTE: PastelColorTheme[] = [
  {
    key: "sky",
    label: "Pastel Sky Blue",
    bg: "#E0F2FE",
    bgHover: "#BAE6FD",
    border: "#7DD3FC",
    accent: "#0284C7",
    text: "#0C4A6E",
    subtext: "#0369A1",
  },
  {
    key: "mint",
    label: "Pastel Mint Green",
    bg: "#DCFCE7",
    bgHover: "#BBF7D0",
    border: "#86EFAC",
    accent: "#16A34A",
    text: "#14532D",
    subtext: "#15803D",
  },
  {
    key: "lavender",
    label: "Pastel Lavender",
    bg: "#F3E8FF",
    bgHover: "#E9D5FF",
    border: "#D8B4FE",
    accent: "#9333EA",
    text: "#581C87",
    subtext: "#7E22CE",
  },
  {
    key: "peach",
    label: "Pastel Peach",
    bg: "#FFEDD5",
    bgHover: "#FED7AA",
    border: "#FDBA74",
    accent: "#EA580C",
    text: "#7C2D12",
    subtext: "#C2410C",
  },
  {
    key: "rose",
    label: "Pastel Rose",
    bg: "#FFE4E6",
    bgHover: "#FECDD3",
    border: "#FDA4AF",
    accent: "#E11D48",
    text: "#881337",
    subtext: "#BE123C",
  },
  {
    key: "lemon",
    label: "Pastel Lemon",
    bg: "#FEF9C3",
    bgHover: "#FEF08A",
    border: "#FDE047",
    accent: "#CA8A04",
    text: "#713F12",
    subtext: "#A16207",
  },
  {
    key: "aqua",
    label: "Pastel Aqua",
    bg: "#CCFBF1",
    bgHover: "#99F6E4",
    border: "#5EEAD4",
    accent: "#0D9488",
    text: "#134E4A",
    subtext: "#0F766E",
  },
  {
    key: "periwinkle",
    label: "Pastel Periwinkle",
    bg: "#E0E7FF",
    bgHover: "#C7D2FE",
    border: "#A5B4FC",
    accent: "#4F46E5",
    text: "#312E81",
    subtext: "#4338CA",
  },
  {
    key: "pink",
    label: "Pastel Blush Pink",
    bg: "#FCE7F3",
    bgHover: "#FBCFE8",
    border: "#F9A8D4",
    accent: "#DB2777",
    text: "#831843",
    subtext: "#BE185D",
  },
  {
    key: "sage",
    label: "Pastel Sage",
    bg: "#ECFCCB",
    bgHover: "#D9F99D",
    border: "#BEF264",
    accent: "#65A30D",
    text: "#365314",
    subtext: "#4D7C0F",
  },
  {
    key: "ice",
    label: "Pastel Ice Cyan",
    bg: "#CFFAFE",
    bgHover: "#A5F3FC",
    border: "#67E8F9",
    accent: "#0891B2",
    text: "#164E63",
    subtext: "#0E7490",
  },
  {
    key: "lilac",
    label: "Pastel Lilac",
    bg: "#FAE8FF",
    bgHover: "#F5D0FE",
    border: "#F0ABFC",
    accent: "#C026D3",
    text: "#701A75",
    subtext: "#A21CAF",
  },
];

const PALETTE_MAP = new Map(TEACHER_PASTEL_PALETTE.map((c) => [c.key, c]));

export function encodeTeacherColorAvatar(colorKey: string): string {
  const validKey = PALETTE_MAP.has(colorKey) ? colorKey : "sky";
  return `pastel:${validKey}`;
}

export function extractTeacherColorKey(
  avatarOrColor?: string | null
): string | null {
  if (!avatarOrColor) return null;
  const cleaned = avatarOrColor.startsWith("pastel:")
    ? avatarOrColor.slice("pastel:".length).trim().toLowerCase()
    : avatarOrColor.trim().toLowerCase();
  return PALETTE_MAP.has(cleaned) ? cleaned : null;
}

export function pickNextAvailablePastelColor(
  existingAvatarOrColors: Array<string | null | undefined>
): string {
  const counts = new Map<string, number>();
  for (const c of TEACHER_PASTEL_PALETTE) {
    counts.set(c.key, 0);
  }

  for (const raw of existingAvatarOrColors) {
    const key = extractTeacherColorKey(raw);
    if (key && counts.has(key)) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  // Pick the color in palette order with the lowest usage count (so 1st teacher = sky, 2nd = mint, etc.)
  let bestKey = TEACHER_PASTEL_PALETTE[0].key;
  let minCount = Infinity;
  for (const theme of TEACHER_PASTEL_PALETTE) {
    const count = counts.get(theme.key) ?? 0;
    if (count < minCount) {
      minCount = count;
      bestKey = theme.key;
    }
  }

  return bestKey;
}

export function getTeacherPastelTheme(
  teacherId?: string | null,
  avatarOrColor?: string | null
): PastelColorTheme {
  const explicitKey = extractTeacherColorKey(avatarOrColor);
  if (explicitKey) {
    const found = PALETTE_MAP.get(explicitKey);
    if (found) return found;
  }

  if (!teacherId) {
    return TEACHER_PASTEL_PALETTE[0];
  }

  // Deterministic fallback hash if no explicit color was saved
  let hash = 0;
  for (let i = 0; i < teacherId.length; i++) {
    hash = (hash * 31 + teacherId.charCodeAt(i)) >>> 0;
  }
  return TEACHER_PASTEL_PALETTE[hash % TEACHER_PASTEL_PALETTE.length];
}

