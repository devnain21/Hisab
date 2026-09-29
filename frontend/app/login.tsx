import { View, Text, StyleSheet, ActivityIndicator, Image, Platform, Pressable as RNPressable } from "react-native";
import { useState } from "react";
import { Redirect } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown, interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/theme";

export default function Login() {
  const { status, signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "authenticated") return <Redirect href="/(tabs)" />;

  const handleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await signIn();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "साइन इन नहीं हो पाया, दोबारा कोशिश करें");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.xxl }]} testID="login-screen">
      <Animated.View entering={FadeIn.duration(500)} style={styles.brandArea}>
        <Image source={require("@/assets/images/splash-icon.png")} style={styles.logo} />
        <Text style={styles.title}>हिसाब</Text>
        <Text style={styles.tagline}>बही खाता</Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.bottomArea}>
        <GoogleButton loading={loading} onPress={handleSignIn} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Animated.View>
    </View>
  );
}

function GoogleButton({ loading, onPress }: { loading: boolean; onPress: () => void }) {
  const pressed = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.value, [0, 1], [1, 0.96]) }],
    backgroundColor: interpolateColor(pressed.value, [0, 1], [colors.brandPrimary, colors.brandSecondary]),
    shadowOpacity: interpolate(pressed.value, [0, 1], [0.25, 0.08]),
    elevation: interpolate(pressed.value, [0, 1], [6, 1]),
  }));

  return (
    <RNPressable
      testID="google-signin-button"
      disabled={loading}
      onPressIn={() => {
        pressed.value = withSpring(1, { damping: 15, stiffness: 400 });
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { damping: 12, stiffness: 300 });
      }}
      onPress={onPress}
      style={{ width: "100%", maxWidth: 420 }}
    >
      <Animated.View style={[styles.googleBtn, animatedStyle, loading && { opacity: 0.85 }]}>
        <View style={styles.googleBadge}>
          <MaterialIcon name="google" size={20} color={colors.brandPrimary} />
        </View>
        {loading ? (
          <ActivityIndicator color={colors.onBrandPrimary} style={{ flex: 1 }} />
        ) : (
          <Text style={styles.googleText}>Google से जारी रखें</Text>
        )}
        <MaterialIcon name="arrow-right" size={20} color="rgba(255,255,255,0.85)" style={{ marginRight: spacing.md }} />
      </Animated.View>
    </RNPressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.xl },
  brandArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  logo: { width: 96, height: 96, marginBottom: spacing.lg },
  title: { fontSize: 40, color: colors.onSurface, fontWeight: "700" },
  tagline: { fontSize: 15, color: colors.muted, marginTop: spacing.xs },
  bottomArea: { alignItems: "center", gap: spacing.md },
  googleBtn: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill,
    minHeight: 58, padding: 6,
    shadowColor: colors.brandSecondary, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  googleBadge: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  googleText: { flex: 1, textAlign: "center", color: colors.onBrandPrimary, fontSize: 17, fontWeight: "700" },
  error: { fontSize: 13, color: colors.error, textAlign: "center" },
});
