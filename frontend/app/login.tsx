import { View, Text, StyleSheet, ActivityIndicator, Image } from "react-native";
import { Pressable } from "@/src/components/tap";
import { useState } from "react";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius } from "@/src/theme";
import { Redirect } from "expo-router";

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
      setError(e instanceof Error ? e.message : "Sign-in fail ho gaya");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]} testID="login-screen">
      <View style={styles.brandArea}>
        <Image source={require("@/assets/images/splash-icon.png")} style={styles.logo} />
        <Text style={styles.tag}>NAIN PHOTO STATE</Text>
        <Text style={styles.title}>हिसाब</Text>
        <Text style={styles.subtitle}>
          उधार, जमा और आने वाला काम —{"\n"}सब कुछ एक जगह, ऑनलाइन सुरक्षित।
        </Text>
      </View>

      <View style={styles.bottomArea}>
        <Text style={styles.hint}>अपना Google खाता जोड़ें ताकि सारा डेटा सुरक्षित रहे</Text>
        <Pressable
          testID="google-signin-button"
          onPress={handleSignIn}
          disabled={loading}
          style={styles.googleBtn}
        >
          {loading ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <>
              <MaterialIcon name="google" size={22} color={colors.onBrandPrimary} />
              <Text style={styles.googleText}>Google से साइन इन करें</Text>
            </>
          )}
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.footer}>साइन इन करके आप डेटा को क्लाउड में सेव करने की सहमति देते हैं।</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.xl, justifyContent: "space-between" },
  brandArea: { alignItems: "center", marginTop: spacing.xxxl },
  logo: { width: 112, height: 112, marginBottom: spacing.xl },
  tag: { fontSize: 11, letterSpacing: 3, color: colors.brandSecondary, marginBottom: spacing.sm, fontWeight: "700" },
  title: { fontSize: 48, color: colors.onSurface, fontWeight: "700", marginBottom: spacing.md },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: "center", lineHeight: 24 },
  bottomArea: { alignItems: "center", gap: spacing.md },
  hint: { fontSize: 13, color: colors.muted, textAlign: "center", marginBottom: spacing.xs },
  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md,
    backgroundColor: colors.brandPrimary,
    paddingVertical: 16, paddingHorizontal: spacing.xl, borderRadius: radius.md,
    width: "100%", minHeight: 56,
  },
  googleText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "600" },
  error: { fontSize: 13, color: colors.error, textAlign: "center" },
  footer: { fontSize: 11, color: colors.muted, textAlign: "center", marginTop: spacing.sm },
});
