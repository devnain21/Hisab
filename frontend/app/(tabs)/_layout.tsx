import { Tabs, Redirect } from "expo-router";
import MaterialIcon from "@react-native-vector-icons/material-design-icons";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";
import { View, ActivityIndicator } from "react-native";

export default function TabsLayout() {
  const { status } = useAuth();
  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }
  if (status === "unauthenticated") return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandSecondary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
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
          title: "ग्राहक",
          tabBarIcon: ({ color, size }) => <MaterialIcon name="account-group" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: "काम",
          tabBarIcon: ({ color, size }) => <MaterialIcon name="briefcase-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "खाता",
          tabBarIcon: ({ color, size }) => <MaterialIcon name="account-circle-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
