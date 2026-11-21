import network.awai.platform.UpdatePolicy;
import network.awai.platform.UpdatePolicy.*;
import java.util.*;

/** Plain JVM tests for UpdatePolicy (AWAI-3660). Run: bash android/tests/update-policy.sh */
public final class UpdatePolicyTest {
    static int failures = 0, checks = 0;
    static final long NOW = 1_800_000_000L, DAY = 86_400L;
    static final String SIGNER = repeat('a'), OTHER = repeat('b'), ID = "network.itonami.torihiki.bot";
    static String repeat(char ch) { char[] c = new char[64]; Arrays.fill(c, ch); return new String(c); }
    static Set<String> set(String... xs) { return new HashSet<>(Arrays.asList(xs)); }
    static final String READ_BOTS = "bots-itonami-cloud|https://bots.itonami.cloud|GET /v1/bots|request-ip";
    static final String READ_NODE = "torihiki-devnet|https://devnet.example|GET /book|request-ip";

    static Approval approval() { return new Approval(true, NOW - DAY, NOW + 30 * DAY, set(), true); }
    static Installed installed() {
        return new Installed(ID, 1000, SIGNER, true, set("android.permission.INTERNET"), set(READ_BOTS, READ_NODE));
    }
    static Candidate candidate() {
        return new Candidate(true, 108, NOW + 20 * DAY, ID, 1001, SIGNER, 29_506_324, true,
                set("android.permission.INTERNET"), set(READ_BOTS, READ_NODE));
    }
    static Device device() { return new Device(NOW, 107, 40L << 20, 0, 200L << 20, true); }

    static void expect(String name, List<String> got, String... want) {
        checks++;
        if (!new HashSet<>(got).equals(set(want))) {
            failures++;
            System.out.println("FAIL " + name + ": got " + got + ", want " + Arrays.asList(want));
        } else System.out.println("ok   " + name + (want.length == 0 ? " (eligible)" : " -> " + Arrays.asList(want)));
    }
    static void same(String name, List<String> got, String... want) {
        checks++;
        if (!got.equals(Arrays.asList(want))) { failures++; System.out.println("FAIL " + name + ": got " + got + ", want " + Arrays.asList(want)); }
        else System.out.println("ok   " + name + " -> " + got);
    }
    static List<String> run(Approval a, Installed i, Candidate c, Device d) { return UpdatePolicy.refusals(a, i, c, d); }

    public static void main(String[] args) {
        Approval a = approval(); Installed i = installed(); Candidate c = candidate(); Device d = device();
        expect("all conditions hold", run(a, i, c, d));
        checks++; if (!UpdatePolicy.eligible(a, i, c, d)) { failures++; System.out.println("FAIL eligible() disagrees"); }

        // The approval itself.
        expect("approval off", run(new Approval(false, a.grantedAt, a.expiresAt, set(), true), i, c, d), "approval-off");
        expect("no approval", run(null, i, c, d), "approval-off");
        expect("approval expired", run(new Approval(true, NOW - 40 * DAY, NOW, set(), true), i, c, d), "approval-expired");
        expect("approval longer than 90 days", run(new Approval(true, NOW - DAY, NOW - DAY + UpdatePolicy.MAX_APPROVAL_SECONDS + 1, set(), true), i, c, d), "approval-period");
        expect("approval granted in the future", run(new Approval(true, NOW + 10, NOW + 20 * DAY, set(), true), i, c, d), "approval-time");
        expect("app excluded by the person", run(new Approval(true, a.grantedAt, a.expiresAt, set(ID), true), i, c, d), "app-excluded");
        expect("exclusion list unknown", run(new Approval(true, a.grantedAt, a.expiresAt, null, true), i, c, d), "app-excluded");

        // 1. Catalog.
        expect("catalog signature not verified", run(a, i, new Candidate(false, 108, c.catalogExpiresAt, ID, 1001, SIGNER, c.bytes, true, c.permissions, c.operations), d), "catalog-signature");
        expect("catalog rolled back", run(a, i, new Candidate(true, 106, c.catalogExpiresAt, ID, 1001, SIGNER, c.bytes, true, c.permissions, c.operations), d), "catalog-rollback");
        expect("catalog expired", run(a, i, new Candidate(true, 108, NOW, ID, 1001, SIGNER, c.bytes, true, c.permissions, c.operations), d), "catalog-expired");
        // 2. Same app, signer, newer, installed by this Store.
        expect("package changed", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, "network.itonami.other", 1001, SIGNER, c.bytes, true, c.permissions, c.operations), d), "package-changed");
        expect("signer changed", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, ID, 1001, OTHER, c.bytes, true, c.permissions, c.operations), d), "signer-changed");
        expect("signer malformed", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, ID, 1001, "short", c.bytes, true, c.permissions, c.operations), d), "signer-changed");
        expect("same version", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, ID, 1000, SIGNER, c.bytes, true, c.permissions, c.operations), d), "not-newer");
        expect("downgrade", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, ID, 999, SIGNER, c.bytes, true, c.permissions, c.operations), d), "not-newer");
        expect("installed by another installer", run(a, new Installed(ID, 1000, SIGNER, false, i.permissions, i.operations), c, d), "not-installed-by-store");
        // 3. Digest.
        expect("digest mismatch", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, ID, 1001, SIGNER, c.bytes, false, c.permissions, c.operations), d), "digest");
        // 4. Permissions.
        expect("new Android permission", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, ID, 1001, SIGNER, c.bytes, true, set("android.permission.INTERNET", "android.permission.CAMERA"), c.operations), d), "new-permission");
        expect("fewer permissions are fine", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, ID, 1001, SIGNER, c.bytes, true, set(), c.operations), d));
        expect("permissions unknown", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, ID, 1001, SIGNER, c.bytes, true, null, c.operations), d), "new-permission");
        // 5. Operations.
        expect("new external operation", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, ID, 1001, SIGNER, c.bytes, true, c.permissions, set(READ_BOTS, READ_NODE, "torihiki-devnet|https://devnet.example|POST /order|request-ip,account-key")), d), "new-operation");
        expect("same operation with a new data category", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, ID, 1001, SIGNER, c.bytes, true, c.permissions, set(READ_BOTS, "torihiki-devnet|https://devnet.example|GET /book|request-ip,device-id")), d), "new-operation");
        expect("fewer operations are fine", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, ID, 1001, SIGNER, c.bytes, true, c.permissions, set(READ_BOTS)), d));
        expect("operations unknown (installed)", run(a, new Installed(ID, 1000, SIGNER, true, i.permissions, null), c, d), "operations-unknown");
        expect("operations unknown (candidate)", run(a, i, new Candidate(true, 108, c.catalogExpiresAt, ID, 1001, SIGNER, c.bytes, true, c.permissions, null), d), "operations-unknown");
        // 6. Budgets.
        expect("over the app budget", run(a, i, c, new Device(NOW, 107, c.bytes - 1, 0, 200L << 20, true)), "app-budget");
        expect("over the daily budget", run(a, i, c, new Device(NOW, 107, 40L << 20, (200L << 20) - c.bytes + 1, 200L << 20, true)), "daily-budget");
        expect("exactly at the daily budget", run(a, i, c, new Device(NOW, 107, 40L << 20, (200L << 20) - c.bytes, 200L << 20, true)));
        // 7. Network.
        expect("metered network", run(a, i, c, new Device(NOW, 107, 40L << 20, 0, 200L << 20, false)), "network-metered");
        expect("metered network allowed by the person", run(new Approval(true, a.grantedAt, a.expiresAt, set(), false), i, c, new Device(NOW, 107, 40L << 20, 0, 200L << 20, false)));

        expect("missing facts", run(a, null, c, d), "missing-facts");
        expect("several at once", run(new Approval(false, 0, 0, set(), true), i, new Candidate(true, 108, c.catalogExpiresAt, ID, 999, OTHER, c.bytes, true, c.permissions, c.operations), d), "approval-off", "signer-changed", "not-newer");

        // The update screen lists exactly the added permissions (AWAI-3653), in a stable order.
        same("added permissions: none", UpdatePolicy.addedPermissions(set("android.permission.INTERNET", "android.permission.POST_NOTIFICATIONS"), set("android.permission.INTERNET")));
        same("added permissions: removed one is not added", UpdatePolicy.addedPermissions(set("android.permission.CAMERA"), set()));
        same("added permissions: two, sorted", UpdatePolicy.addedPermissions(set("android.permission.INTERNET"),
                set("android.permission.POST_NOTIFICATIONS", "android.permission.INTERNET", "android.permission.CAMERA")),
                "android.permission.CAMERA", "android.permission.POST_NOTIFICATIONS");

        System.out.println(checks + " checks, " + failures + " failures");
        if (failures > 0) System.exit(1);
    }
}
