import { useRef } from "react";
import { Platform, Pressable as RNPressable, type PressableProps } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * Wraps a save handler so a second tap is ignored until the first one finishes (its promise settles), plus a
 * short cool-down: `disabled` only takes effect after a re-render, which a fast double tap beats.
 */
export function useOnce(run: () => unknown): () => void {
  const busy = useRef(false);
  return () => {
    if (busy.current) return;
    busy.current = true;
    const release = () => setTimeout(() => { busy.current = false; }, 400);
    try {
      Promise.resolve(run()).then(release, release);
    } catch (e) {
      release();
      throw e;
    }
  };
}

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
