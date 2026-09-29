import { Platform, Pressable as RNPressable, type PressableProps } from "react-native";
import * as Haptics from "expo-haptics";

type Props = PressableProps & { haptic?: boolean };

export function Pressable({ style, onPress, haptic = true, disabled, ...rest }: Props) {
  return (
    <RNPressable
      {...rest}
      disabled={disabled}
      onPress={
        onPress &&
        ((e) => {
          if (haptic && Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
          onPress(e);
        })
      }
      style={(state) => [
        typeof style === "function" ? style(state) : style,
        state.pressed && !disabled && { opacity: 0.75, transform: [{ scale: 0.97 }] },
      ]}
    />
  );
}
