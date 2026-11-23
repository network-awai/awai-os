package network.awai.systembars;

import android.app.Activity;
import android.content.res.Configuration;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;

/**
 * Applies the shared {@link SystemBarAppearance} to an Android window
 * (AWAI-3443).
 *
 * <p>Apps call one entry point here (normally {@link
 * #applyForUiMode(Activity, Configuration)}) and pass only their theme and,
 * optionally, an accent color. This class owns every {@code setStatusBarColor},
 * {@code setNavigationBarColor}, decor-color, icon-appearance and
 * navigation-contrast write in awai-os; no app may set those directly.
 *
 * <p>Dependency direction is one-way: apps {@code ->} this library, and this
 * library knows nothing about any app. The library depends only on the
 * Android framework (API 24+, no AndroidX), so it compiles both into Tauri
 * apps (via {@code sourceSets.java.srcDir} in each app's
 * {@code build.gradle.kts}) and into the {@code android/} Java hosts (compiled
 * by {@code android/build.py}).
 *
 * <p>This is a local display setting, not an external operation: it grants no
 * capability and needs no Kotoba consent or Tauri capability of its own.
 */
public final class SystemBars {

    private SystemBars() {
    }

    /** Applies the given appearance to the activity's window. */
    public static void apply(Activity activity, SystemBarAppearance appearance) {
        applyToWindow(activity.getWindow(), appearance);
    }

    /** Applies an appearance computed from a {@code uiMode} (device dark mode by default). */
    public static void applyForUiMode(Activity activity, Configuration config) {
        apply(activity, SystemBarAppearance.fromUiMode(config.uiMode));
    }

    /** Applies an appearance computed from a {@code uiMode}, over an app accent color. */
    public static void applyForUiMode(Activity activity, Configuration config, int accent) {
        apply(activity, SystemBarAppearance.fromUiMode(config.uiMode, accent));
    }

    /** Applies an appearance computed from an Otehon shell theme name. */
    public static void applyForShellTheme(Activity activity, String shellTheme) {
        apply(activity, SystemBarAppearance.fromShellTheme(shellTheme));
    }

    /** Applies an appearance computed from an Otehon shell theme name, over an app accent color. */
    public static void applyForShellTheme(Activity activity, String shellTheme, int accent) {
        apply(activity, SystemBarAppearance.fromShellTheme(shellTheme, accent));
    }

    private static void applyToWindow(Window window, SystemBarAppearance appearance) {
        // Edge-to-edge bars are drawn over the decor view: paint the decor,
        // the status bar and the navigation bar with the same color so no
        // color leaks in from a theme switch.
        window.getDecorView().setBackgroundColor(appearance.decorColor);
        window.setStatusBarColor(appearance.statusBarColor);
        window.setNavigationBarColor(appearance.navigationBarColor);
        // The 3-button navigation scrim is chosen when the activity starts and
        // does not follow a live theme switch; without it the decor color shows
        // through.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
        }
        applyIconAppearance(window, appearance);
    }

    private static void applyIconAppearance(Window window, SystemBarAppearance appearance) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            int mask = 0;
            if (appearance.lightStatusBars) {
                mask |= WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS;
            }
            if (appearance.lightNavigationBars) {
                mask |= WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            }
            window.getInsetsController().setSystemBarsAppearance(mask, mask);
        } else {
            int visibility = window.getDecorView().getSystemUiVisibility();
            visibility &= ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                    | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            if (appearance.lightStatusBars) {
                visibility |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            }
            if (appearance.lightNavigationBars) {
                visibility |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(visibility);
        }
    }
}
