import { Tabs, Redirect } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";
import { View, ActivityIndicator, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { useFoldLegacyCashRows } from "@/src/lib/records";
import { useCounterMode } from "@/src/lib/counter";
import { usePersona } from "@/src/lib/persona";
import { useUdhaarReminders } from "@/src/lib/notify";

function LedgerMaintenance() {
  useFoldLegacyCashRows();
  useUdhaarReminders();
  return null;
}

export default function TabsLayout() {
  const { status } = useAuth();
  const counter = useCounterMode();
  const { labels, isPersonal, ready } = usePersona();
  if (status === "loading" || (status === "authenticated" && !ready)) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }
  if (status === "unauthenticated") return <Redirect href="/login" />;

  return (
    <>
    <LedgerMaintenance />
    <Tabs
      backBehavior="firstRoute"
      screenListeners={{
        tabPress: () => {
          if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
        },
      }}
      screenOptions={{
        headerShown: false,
        animation: "shift",
        tabBarActiveTintColor: colors.brandSecondary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        tabBarItemStyle: { alignSelf: "center" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "घर",
          tabBarIcon: ({ color, size }) => <MaterialIcon name="home-variant" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: labels.customers,
          tabBarIcon: ({ color, size }) => <MaterialIcon name="account-group" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: labels.work,
          tabBarIcon: ({ color, size }) => <MaterialIcon name="briefcase-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: "मेरे काम",
          href: isPersonal ? undefined : null,
          tabBarIcon: ({ color, size }) => <MaterialIcon name="clipboard-check-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="aeps"
        options={{
          title: "काउंटर",
          href: counter.on ? undefined : null,
          tabBarIcon: ({ color, size }) => <MaterialIcon name="fingerprint" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
          title: "खाता",
        }}
      />
    </Tabs>
    </>
  );
}
