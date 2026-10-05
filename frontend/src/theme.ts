// Design tokens for Nain Photo State — Hisab (Hindi khata app)
// Paper/bahi-khata palette from /app/design_guidelines.json
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  // Surfaces
  surface: "#FDFBF7", // cream paper
  onSurface: "#1A1A1A", // ink
  surfaceSecondary: "#F4EFE6", // aged paper
  onSurfaceSecondary: "#2D2D2D",
  surfaceTertiary: "#EBE4D5", // deeper paper
  onSurfaceTertiary: "#2D2D2D",
  surfaceInverse: "#2D2D2D",
  onSurfaceInverse: "#FDFBF7",
  muted: "#737373",

  // Brand — teal ink
  brand: "#00796B",
  onBrand: "#FFFFFF",
  brandPrimary: "#00796B",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#004D40",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#E0F2F1",
  onBrandTertiary: "#004D40",

  // Status
  success: "#2E7D32", // forest (jama)
  onSuccess: "#FFFFFF",
  successSoft: "#E8F5E9",
  warning: "#B45309",
  onWarning: "#FFFFFF",
  error: "#C62828", // brick (udhaar)
  onError: "#FFFFFF",
  errorSoft: "#FDECEA",
  info: "#1D4ED8",
  onInfo: "#FFFFFF",
  infoSoft: "#EFF6FF",

  // Lines
  border: "#EBE4D5",
  borderStrong: "#D6CDB8",
  divider: "#EBE4D5",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme =
    (system === "light" || system === "dark") && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const colors = light;

/** One colour per money meaning, used the same way on every screen. */
export const semantic = {
  due: light.error,
  dueSoft: light.errorSoft,
  received: light.success,
  receivedSoft: light.successSoft,
  pending: light.warning,
  pendingSoft: "#FFF4E5",
  bank: light.info,
  bankSoft: light.infoSoft,
  cash: light.success,
  whatsapp: "#128C7E",
  whatsappSoft: "#E7F6F3",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };

// Devanagari matras sit above and below the line; ~1.5x line height keeps them from being clipped on Android.
// 12 is the smallest size Hindi stays readable at.
export const type = {
  caption: { fontSize: 12, lineHeight: 18 },
  body: { fontSize: 14, lineHeight: 21 },
  bodyLg: { fontSize: 16, lineHeight: 24 },
  title: { fontSize: 20, lineHeight: 30 },
  headline: { fontSize: 24, lineHeight: 34 },
  display: { fontSize: 32, lineHeight: 44 },
} as const;

export const weight = { regular: "400", medium: "500", semibold: "600", bold: "700", heavy: "800" } as const;

export const elevation = {
  none: {},
  low: { elevation: 1, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  mid: { elevation: 3, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  high: { elevation: 6, shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
} as const;

/** Smallest comfortable tap target. */
export const TAP = 44;
