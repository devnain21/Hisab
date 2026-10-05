// Shared building blocks. New and reworked screens use these instead of one-off styles,
// so sizes, colours and tap targets stay the same everywhere.
import { useEffect, useRef, type ReactNode } from "react";
import { ActivityIndicator, Animated, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useRouter } from "expo-router";
import { Pressable } from "@/src/components/tap";
import { HIDDEN, usePrefs } from "@/src/lib/prefs";
import { formatINR } from "@/src/lib/format";
import { TAP, colors, elevation, radius, semantic, spacing, type, weight } from "@/src/theme";

type IconName = React.ComponentProps<typeof MaterialIcon>["name"];

export type AmountTone = "due" | "received" | "pending" | "bank" | "neutral" | "muted";
const TONE: Record<AmountTone, string> = {
  due: semantic.due,
  received: semantic.received,
  pending: semantic.pending,
  bank: semantic.bank,
  neutral: colors.onSurface,
  muted: colors.muted,
};

/** Rupees with even-width digits, a true minus sign, and masking while "hide amounts" is on. */
export function Amount({
  value,
  tone = "neutral",
  sign,
  size = "body",
  bold = true,
  style,
  revealed,
  testID,
}: {
  value: number;
  tone?: AmountTone;
  /** "+" or "−" in front; "auto" shows "−" for negative values. */
  sign?: "+" | "−" | "auto";
  size?: keyof typeof type;
  bold?: boolean;
  style?: StyleProp<TextStyle>;
  /** Shown even when amounts are hidden (e.g. inside a sheet the user opened). */
  revealed?: boolean;
  testID?: string;
}) {
  const { hideAmounts } = usePrefs();
  const prefix = sign === "auto" ? (value < 0 ? "−" : "") : sign ?? "";
  const text = hideAmounts && !revealed ? HIDDEN : `${prefix}${formatINR(sign ? Math.abs(value) : value)}`;
  return (
    <Text
      style={[type[size], { color: TONE[tone], fontWeight: bold ? weight.bold : weight.regular, fontVariant: ["tabular-nums"] }, style]}
      numberOfLines={1}
      testID={testID}
    >
      {text}
    </Text>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  loading,
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const bg = variant === "primary" ? colors.brandPrimary : variant === "danger" ? colors.error : variant === "secondary" ? colors.brandTertiary : "transparent";
  const fg = variant === "primary" || variant === "danger" ? colors.onBrandPrimary : colors.brandSecondary;
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={[
        { minHeight: 48, borderRadius: radius.md, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: bg },
        off && { opacity: 0.5 },
        style,
      ]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <MaterialIcon name={icon} size={20} color={fg} /> : null}
          <Text style={[type.bodyLg, { color: fg, fontWeight: weight.bold }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** Icon-only button. `label` is what a screen reader says, so it is required; the target is never under 44px. */
export function IconButton({
  icon,
  label,
  onPress,
  color = colors.onSurface,
  background,
  size = 22,
  style,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  background?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={[{ minWidth: TAP, minHeight: TAP, borderRadius: TAP / 2, alignItems: "center", justifyContent: "center", backgroundColor: background }, style]}
      testID={testID}
    >
      <MaterialIcon name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  icon,
  tone = colors.brandPrimary,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: IconName;
  tone?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 4, bottom: 4 }}
      style={[
        { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
        active && { backgroundColor: tone, borderColor: tone },
      ]}
      testID={testID}
    >
      {icon ? <MaterialIcon name={icon} size={16} color={active ? colors.onBrandPrimary : colors.onSurface} /> : null}
      <Text style={[type.body, { fontWeight: weight.semibold, color: active ? colors.onBrandPrimary : colors.onSurface }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A heading or line with a leading vector icon (in place of an emoji). */
export function IconLabel({
  icon,
  label,
  color = colors.onSurface,
  iconColor,
  style,
  boxStyle,
}: {
  icon: IconName;
  label: ReactNode;
  color?: string;
  iconColor?: string;
  style?: StyleProp<TextStyle>;
  boxStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 6 }, boxStyle]}>
      <MaterialIcon name={icon} size={18} color={iconColor ?? color} />
      <Text style={[type.body, { color, fontWeight: weight.heavy, flexShrink: 1 }, style]}>{label}</Text>
    </View>
  );
}

/** Small read-only status label. */
export function Pill({ label, color, background, icon }: { label: string; color: string; background: string; icon?: IconName }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: background }}>
      {icon ? <MaterialIcon name={icon} size={13} color={color} /> : null}
      <Text style={[type.caption, { fontWeight: weight.bold, color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Card({ children, style, raised, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; raised?: boolean; testID?: string }) {
  return (
    <View
      style={[
        { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
        raised && elevation.low,
        style,
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
}

/** Title row for a pushed screen; the back arrow falls back to Home when there is no history. */
export function ScreenHeader({ title, subtitle, right, onBack }: { title: string; subtitle?: string; right?: ReactNode; onBack?: () => void }) {
  const router = useRouter();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace("/")));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
      <IconButton icon="arrow-left" label="वापस" onPress={back} testID="screen-back" />
      <View style={{ flex: 1 }}>
        <Text style={[type.title, { fontWeight: weight.heavy, color: colors.onSurface }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.caption, { color: colors.muted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message?: string; action?: { label: string; onPress: () => void; testID?: string } }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl, gap: spacing.sm }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
        <MaterialIcon name={icon} size={30} color={colors.brandPrimary} />
      </View>
      <Text style={[type.bodyLg, { fontWeight: weight.bold, color: colors.onSurface, textAlign: "center" }]}>{title}</Text>
      {message ? <Text style={[type.body, { color: colors.muted, textAlign: "center" }]}>{message}</Text> : null}
      {action ? <Button label={action.label} onPress={action.onPress} style={{ marginTop: spacing.sm, alignSelf: "stretch" }} testID={action.testID} /> : null}
    </View>
  );
}

/** Placeholder block shown while a list loads for the first time. */
export function Skeleton({ width = "100%", height = 16, rounded = radius.sm, style }: { width?: number | `${number}%`; height?: number; rounded?: number; style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ width, height, borderRadius: rounded, backgroundColor: colors.surfaceTertiary, opacity: pulse }, style]} />;
}
