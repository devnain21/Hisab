// Keeps balances out of the Android recent-apps preview (Android 13+); screenshots stay allowed.
const { withMainActivity } = require("@expo/config-plugins");

const LINE = "if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false)";

module.exports = function withRecentsPrivacy(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes("setRecentsScreenshotEnabled")) return cfg;
    if (!src.includes("import android.os.Build")) src = src.replace(/^package .*$/m, (p) => `${p}\nimport android.os.Build`);
    src = src.replace(/super\.onCreate\((null|savedInstanceState)\)/, (m) => `${m}\n    // @generated begin hisab-recents-privacy\n    ${LINE}\n    // @generated end hisab-recents-privacy`);
    cfg.modResults.contents = src;
    return cfg;
  });
};
