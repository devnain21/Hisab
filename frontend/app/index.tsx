import { Redirect } from "expo-router";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";

export default function Index() {
  const { status } = useAuth();
  if (status === "loading") {
    return (
      <View style={styles.center} testID="root-loading">
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }
  if (status === "authenticated") return <Redirect href="/(tabs)" />;
  return <Redirect href="/login" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
