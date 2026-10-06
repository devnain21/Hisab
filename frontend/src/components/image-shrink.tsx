import { useCallback, useRef, useState, type ReactNode } from "react";
import { Platform, UIManager, View } from "react-native";
import type { WebView as WebViewType, WebViewMessageEvent } from "react-native-webview";

export type ShrinkOpts = {
  /** Longest side in px; the image is never enlarged. */
  maxSide: number;
  /** Hard cap on the decoded image size. */
  maxBytes: number;
  /** Turn the near-white paper around a signature transparent (PNG output). */
  clearWhite?: boolean;
};

/** Decoded size of a base64 data URI. */
export const dataUriBytes = (uri: string) => {
  const b64 = uri.slice(uri.indexOf(",") + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
};

// Runs inside a browser canvas (the web app itself, or a hidden WebView on the phone). Plain ES5 on purpose.
const SHRINK_JS = `
function hisabShrink(src, o, done) {
  var img = new Image();
  img.onload = function () {
    var side = o.maxSide;
    for (var round = 0; round < 6; round++) {
      var k = Math.min(1, side / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var g = c.getContext("2d");
      g.drawImage(img, 0, 0, w, h);
      var out;
      if (o.clearWhite) {
        var d = g.getImageData(0, 0, w, h), p = d.data;
        for (var i = 0; i < p.length; i += 4) {
          var lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
          if (lum > 200) p[i + 3] = 0;
          else { p[i + 3] = Math.min(255, Math.round((200 - lum) * 4)); p[i] = Math.round(p[i] * 0.6); p[i + 1] = Math.round(p[i + 1] * 0.6); p[i + 2] = Math.round(p[i + 2] * 0.6); }
        }
        g.putImageData(d, 0, 0);
        out = c.toDataURL("image/png");
      } else {
        out = c.toDataURL("image/webp", 0.82);
        if (out.indexOf("data:image/webp") !== 0) out = c.toDataURL("image/jpeg", 0.82);
      }
      var b64 = out.slice(out.indexOf(",") + 1);
      var bytes = Math.floor(b64.length * 3 / 4);
      if (bytes <= o.maxBytes) return done(out, "");
      side = Math.round(side * 0.75);
    }
    done("", "big");
  };
  img.onerror = function () { done("", "bad"); };
  img.src = src;
}
`;

type Pending = { resolve: (uri: string) => void; reject: (e: Error) => void };

const webViewAvailable = () => {
  if (Platform.OS === "web") return false;
  try {
    return !!UIManager.hasViewManagerConfig?.("RNCWebView");
  } catch {
    return false;
  }
};

/**
 * Shrinks a picked image in a canvas so it fits the slip limits. On the phone the canvas lives in a hidden
 * WebView, so render `element` inside the sheet that uses it.
 */
export function useImageShrink(): { shrink: (src: string, o: ShrinkOpts) => Promise<string>; element: ReactNode } {
  const web = useRef<WebViewType | null>(null);
  // Opens once the WebView page (with the canvas code) has loaded.
  const [gate] = useState(() => {
    let open = () => {};
    const loaded = new Promise<void>((r) => (open = r));
    return { loaded, open: () => open() };
  });
  const pending = useRef(new Map<string, Pending>());
  const native = webViewAvailable();

  const shrink = useCallback(
    async (src: string, o: ShrinkOpts): Promise<string> => {
      if (Platform.OS === "web") {
        return new Promise((resolve, reject) => {
          const run = new Function("src", "o", "done", `${SHRINK_JS}; hisabShrink(src, o, done);`) as (s: string, o: ShrinkOpts, d: (u: string, err: string) => void) => void;
          run(src, o, (uri, err) => (uri ? resolve(uri) : reject(new Error(err))));
        });
      }
      // Older APK without the WebView: keep the picked image when it already fits.
      if (!native) {
        if (dataUriBytes(src) <= o.maxBytes) return src;
        throw new Error("big");
      }
      await gate.loaded;
      const id = Math.random().toString(36).slice(2);
      return new Promise((resolve, reject) => {
        pending.current.set(id, { resolve, reject });
        web.current?.injectJavaScript(
          `hisabShrink(${JSON.stringify(src)}, ${JSON.stringify(o)}, function (u, e) { window.ReactNativeWebView.postMessage(JSON.stringify({ id: ${JSON.stringify(id)}, u: u, e: e })); }); true;`,
        );
      });
    },
    [native, gate],
  );

  const onMessage = (ev: WebViewMessageEvent) => {
    try {
      const { id, u, e } = JSON.parse(ev.nativeEvent.data) as { id: string; u: string; e: string };
      const p = pending.current.get(id);
      if (!p) return;
      pending.current.delete(id);
      if (u) p.resolve(u);
      else p.reject(new Error(e || "bad"));
    } catch {}
  };

  let element: ReactNode = null;
  if (native) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WebView } = require("react-native-webview") as typeof import("react-native-webview");
    element = (
      <View style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }} pointerEvents="none">
        <WebView
          ref={web}
          originWhitelist={["*"]}
          source={{ html: `<html><body><script>${SHRINK_JS}</script></body></html>` }}
          onLoadEnd={gate.open}
          onMessage={onMessage}
          javaScriptEnabled
        />
      </View>
    );
  }
  return { shrink, element };
}
