package network.awai.systembars;

/**
 * Unit tests for the pure {@link SystemBarAppearance} policy (AWAI-3443).
 *
 * <p>Plain {@code main()} assertions, zero dependencies: compile and run with
 * any JDK, no Android runtime:
 * <pre>
 * javac -d /tmp/awai-system-bars-test \
 *   packages/awai-system-bars/android/network/awai/systembars/SystemBarAppearance.java \
 *   packages/awai-system-bars/test/SystemBarAppearanceTest.java
 * java -cp /tmp/awai-system-bars-test network.awai.systembars.SystemBarAppearanceTest
 * </pre>
 * Or run {@code python3 packages/awai-system-bars/test/run_tests.py}, which
 * does exactly that. Exit status 1 on any failure.
 */
public final class SystemBarAppearanceTest {

    private static int passed;
    private static int failed;

    private static void check(String name, boolean condition) {
        if (condition) {
            passed++;
            System.out.println("PASS " + name);
        } else {
            failed++;
            System.out.println("FAIL " + name);
        }
    }

    private static void check(String name, boolean actual, boolean expected) {
        check(name + " (expected " + expected + ", got " + actual + ")", actual == expected);
    }

    public static void main(String[] args) {
        final int nightYes = 0x20;
        final int nightNo = 0x10;
        final int mask = 0x30;

        // --- theme following -------------------------------------------------
        check("uiMode NIGHT_YES is dark", SystemBarAppearance.isLightForUiMode(nightYes), false);
        check("uiMode NIGHT_NO is light", SystemBarAppearance.isLightForUiMode(nightNo), true);
        check("uiMode undefined is light", SystemBarAppearance.isLightForUiMode(0x00), true);
        check("uiMode with unrelated bits still reads night", SystemBarAppearance.isLightForUiMode(nightYes | 0x03), false);

        // --- shell theme mapping (dark default, Asa/Hiru light) --------------
        check("shell dark is dark", SystemBarAppearance.isLightForShellTheme("dark"), false);
        check("shell Asa is light", SystemBarAppearance.isLightForShellTheme("Asa"), true);
        check("shell Hiru is light", SystemBarAppearance.isLightForShellTheme("Hiru"), true);
        check("shell null falls back to dark", SystemBarAppearance.isLightForShellTheme(null), false);
        check("shell unknown falls back to dark", SystemBarAppearance.isLightForShellTheme("typo"), false);
        check("shell Asa is case-insensitive", SystemBarAppearance.isLightForShellTheme(" asa "), true);

        // --- light/dark outputs ------------------------------------------------
        SystemBarAppearance light = SystemBarAppearance.fromLight(true);
        check("light status bar color", light.statusBarColor == SystemBarAppearance.LIGHT_BACKGROUND);
        check("light navigation bar color", light.navigationBarColor == SystemBarAppearance.LIGHT_BACKGROUND);
        check("light decor color", light.decorColor == SystemBarAppearance.LIGHT_BACKGROUND);
        check("light uses light-appearance (dark) icons", light.lightStatusBars, true);
        check("light navigation uses dark icons", light.lightNavigationBars, true);

        SystemBarAppearance dark = SystemBarAppearance.fromLight(false);
        check("dark status bar color", dark.statusBarColor == SystemBarAppearance.DARK_BACKGROUND);
        check("dark navigation bar color", dark.navigationBarColor == SystemBarAppearance.DARK_BACKGROUND);
        check("dark decor color", dark.decorColor == SystemBarAppearance.DARK_BACKGROUND);
        check("dark uses light icons", dark.lightStatusBars, false);
        check("dark navigation uses light icons", dark.lightNavigationBars, false);

        // --- uiMode / shellTheme entry points agree with fromLight -------------
        check("fromUiMode dark", SystemBarAppearance.fromUiMode(nightYes).statusBarColor == SystemBarAppearance.DARK_BACKGROUND);
        check("fromUiMode light", SystemBarAppearance.fromUiMode(nightNo).statusBarColor == SystemBarAppearance.LIGHT_BACKGROUND);
        check("fromShellTheme dark", SystemBarAppearance.fromShellTheme("dark").statusBarColor == SystemBarAppearance.DARK_BACKGROUND);
        check("fromShellTheme Asa", SystemBarAppearance.fromShellTheme("Asa").statusBarColor == SystemBarAppearance.LIGHT_BACKGROUND);
        check("fromShellTheme Hiru", SystemBarAppearance.fromShellTheme("Hiru").statusBarColor == SystemBarAppearance.LIGHT_BACKGROUND);
        check("shell backgrounds match their pages",
                SystemBarAppearance.SHELL_ASA_BACKGROUND == 0xFFFFFFFF
                        && SystemBarAppearance.SHELL_HIRU_BACKGROUND == 0xFFEAF7FF
                        && SystemBarAppearance.SHELL_DARK_BACKGROUND == 0xFF15181C);

        // --- icon contrast flip ------------------------------------------------
        check("white wants dark icons", SystemBarAppearance.lightIconsForBackground(0xFFFFFFFF), true);
        check("dark wants light icons", SystemBarAppearance.lightIconsForBackground(0xFF14110F), false);
        check("shell dark wants light icons", SystemBarAppearance.lightIconsForBackground(SystemBarAppearance.SHELL_DARK_BACKGROUND), false);
        check("shell Hiru wants dark icons", SystemBarAppearance.lightIconsForBackground(SystemBarAppearance.SHELL_HIRU_BACKGROUND), true);
        check("bright grey takes dark icons", SystemBarAppearance.lightIconsForBackground(0xFFCCCCCC), true);
        check("mid grey takes light icons", SystemBarAppearance.lightIconsForBackground(0xFF808080), false);

        // --- accent: app passes theme+accent, lib still decides --------------
        SystemBarAppearance onBlue = SystemBarAppearance.fromLight(true, 0xFF1E50A2);
        check("accent overrides light background", onBlue.statusBarColor == 0xFF1E50A2);
        check("accent overrides navigation too", onBlue.navigationBarColor == 0xFF1E50A2);
        check("dark accent takes light icons even in light mode", onBlue.lightStatusBars, false);
        SystemBarAppearance onWhite = SystemBarAppearance.fromLight(false, 0xFFFFFFFF);
        check("light accent takes dark icons even in dark mode", onWhite.lightStatusBars, true);
        check("accent via uiMode", SystemBarAppearance.fromUiMode(nightNo, 0xFF1E50A2).lightStatusBars, false);
        check("accent via shellTheme", SystemBarAppearance.fromShellTheme("Asa", 0xFF14110F).lightStatusBars, false);

        System.out.println("---");
        System.out.println(passed + " passed, " + failed + " failed");
        if (failed > 0) {
            System.exit(1);
        }
    }
}
