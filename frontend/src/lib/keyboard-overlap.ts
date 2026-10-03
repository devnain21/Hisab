import { useEffect, useState } from "react";
import { Keyboard, Platform, type View } from "react-native";

// Android modals don't resize for the keyboard under edge-to-edge, so pad by the measured overlap instead.
export function useKeyboardOverlap(ref: React.RefObject<View | null>) {
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    let keyboardTop: number | null = null;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const measure = () => {
      const top = keyboardTop;
      if (top === null) return;
      ref.current?.measureInWindow((_x, y, _w, h) => {
        if (h > 0 && keyboardTop !== null) setOverlap(Math.max(0, y + h - top));
      });
    };
    // A sheet that focuses a field while it is still sliding in measures mid-animation; measure again once it settles.
    const show = Keyboard.addListener(showEvt, (e) => {
      keyboardTop = e.endCoordinates.screenY;
      timers.forEach(clearTimeout);
      measure();
      timers = [setTimeout(measure, 200), setTimeout(measure, 500)];
    });
    const hide = Keyboard.addListener(hideEvt, () => {
      keyboardTop = null;
      timers.forEach(clearTimeout);
      setOverlap(0);
    });
    return () => {
      timers.forEach(clearTimeout);
      show.remove();
      hide.remove();
    };
  }, [ref]);
  return overlap;
}
