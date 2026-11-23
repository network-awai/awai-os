package network.awai.systembars;

/**
 * Pure system-bar appearance policy (no Android framework calls).
 *
 * <p>Apps never pick bar colors. An app passes only a theme and, optionally, an
 * accent color; this class decides the status-bar color, the navigation-bar
 * color and whether bar icons are drawn in their light appearance. Icon
 * contrast is derived from the luminance of the resulting background, so an
 * accent of either polarity is handled correctly.
 *
 * <p>Device dark mode is followed by default. This class has no lock: every
 * method here reasons from a theme input, and {@link #fromUiMode(int)} reads
 * the device {@code uiMode}, so a following app cannot drift away from the
 * system. Shell themes are mapped to light/dark (see {@link
 * #isLightForShellTheme(String)}); that is the only reconciliation of shell and
 * system themes in this package.
 *
 * <p>Canonical backgrounds match every app's page {@code --bg} (AWAI-3443):
 * {@code --bg} is {@code #ffffff} in light mode and {@code #14110f} in dark
 * mode, and the shared UI palette
 * ({@code android/contracts/src/itonami/store/domain.cljc}) pins the same two
 * values.
 */
public final class SystemBarAppearance {

    /** Light-mode page background ({@code --bg} in light mode). */
    public static final int LIGHT_BACKGROUND = 0xFFFFFFFF;
    /** Dark-mode page background ({@code --bg} in dark mode). */
    public static final int DARK_BACKGROUND = 0xFF14110F;

    /**
     * Shell default (dark) page background: the shell stylesheet's
     * {@code :root} {@code --bg} is {@code #15181c}; this is the dark shell
     * theme with no {@code data-theme} attribute.
     */
    public static final int SHELL_DARK_BACKGROUND = 0xFF15181C;
    /** Shell Asa page background: {@code :root[data-theme="Asa"]} {@code --bg}. */
    public static final int SHELL_ASA_BACKGROUND = 0xFFFFFFFF;
    /** Shell Hiru page background: {@code :root[data-theme="Hiru"]} {@code --bg}. */
    public static final int SHELL_HIRU_BACKGROUND = 0xFFEAF7FF;

    /** Status-bar background color. */
    public final int statusBarColor;
    /** Navigation-bar background color. */
    public final int navigationBarColor;
    /** Decor background color shown behind the edge-to-edge bars. */
    public final int decorColor;
    /** True when status-bar icons must use their light appearance (dark icons). */
    public final boolean lightStatusBars;
    /** True when navigation-bar icons must use their light appearance (dark icons). */
    public final boolean lightNavigationBars;

    public SystemBarAppearance(int statusBarColor, int navigationBarColor, int decorColor,
                               boolean lightStatusBars, boolean lightNavigationBars) {
        this.statusBarColor = statusBarColor;
        this.navigationBarColor = navigationBarColor;
        this.decorColor = decorColor;
        this.lightStatusBars = lightStatusBars;
        this.lightNavigationBars = lightNavigationBars;
    }

    /** Appearance for an explicit light/dark theme. */
    public static SystemBarAppearance fromLight(boolean light) {
        return fromLight(light, 0, false);
    }

    /** Appearance for an explicit light/dark theme over an app accent color. */
    public static SystemBarAppearance fromLight(boolean light, int accent) {
        return fromLight(light, accent, true);
    }

    private static SystemBarAppearance fromLight(boolean light, int accent, boolean hasAccent) {
        int background = hasAccent ? accent : (light ? LIGHT_BACKGROUND : DARK_BACKGROUND);
        boolean lightIcons = lightIconsForBackground(background);
        return new SystemBarAppearance(background, background, background, lightIcons, lightIcons);
    }

    /** Appearance following the device {@code uiMode} (the default for every app). */
    public static SystemBarAppearance fromUiMode(int uiMode) {
        return fromLight(isLightForUiMode(uiMode));
    }

    /** Appearance following the device {@code uiMode}, over an app accent color. */
    public static SystemBarAppearance fromUiMode(int uiMode, int accent) {
        return fromLight(isLightForUiMode(uiMode), accent);
    }

    /**
     * Appearance for an Otehon shell theme name. Accepts {@code "dark"}
     * (explicit or the implicit default), {@code "Asa"} and {@code "Hiru"};
     * unknown names and {@code null} fall back to the shell's dark default,
     * mirroring the stylesheet where {@code :root} is dark and only Asa/Hiru
     * override it to light.
     */
    public static SystemBarAppearance fromShellTheme(String shellTheme) {
        return fromLight(isLightForShellTheme(shellTheme));
    }

    /** Appearance for an Otehon shell theme name, over an app accent color. */
    public static SystemBarAppearance fromShellTheme(String shellTheme, int accent) {
        return fromLight(isLightForShellTheme(shellTheme), accent);
    }

    /**
     * True when {@code uiMode} is not night mode, matching Android's
     * {@code Configuration.UI_MODE_NIGHT_MASK}: {@code UI_MODE_NIGHT_YES}
     * (0x20) is dark, {@code UI_MODE_NIGHT_NO} (0x10) and undefined (0x00)
     * are light.
     */
    public static boolean isLightForUiMode(int uiMode) {
        return (uiMode & 0x30) != 0x20;
    }

    /**
     * True when the shell theme is one of the light shell themes (Asa, Hiru).
     * Dark, anything unknown, and {@code null} map to dark, because the shell
     * stylesheet's default is dark and only Asa/Hiru opt into light.
     */
    public static boolean isLightForShellTheme(String shellTheme) {
        if (shellTheme == null) {
            return false;
        }
        String name = shellTheme.trim();
        return name.equalsIgnoreCase("Asa") || name.equalsIgnoreCase("Hiru");
    }

    /**
     * Relative luminance of an ARGB color (WCAG formula), in {@code [0, 1]}.
     * Computed arithmetically so this class stays free of Android framework
     * calls and its unit tests run on a plain JVM.
     */
    public static double luminance(int argb) {
        double r = channel((argb >>> 16) & 0xFF);
        double g = channel((argb >>> 8) & 0xFF);
        double b = channel(argb & 0xFF);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    /**
     * True when bar icons must use their light appearance (dark icons) over
     * the given background: exactly when the background luminance is above the
     * midpoint. On a light background the result is {@code true}; on a dark
     * background it is {@code false}. This is what makes an accent of either
     * polarity work without the app deciding icon colors.
     */
    public static boolean lightIconsForBackground(int argb) {
        return luminance(argb) > 0.5;
    }

    private static double channel(int component) {
        double value = component / 255.0;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    }
}
