import network.awai.platform.UpdateApprovalRecord;
import network.awai.platform.UpdatePolicy;
import network.awai.platform.UpdatePolicy.Approval;
import java.util.*;

/** Plain JVM tests for UpdateApprovalRecord (AWAI-3661). Run: bash android/tests/update-policy.sh */
public final class UpdateApprovalRecordTest {
    static int failures = 0, checks = 0;
    static final long NOW = 1_800_000_000L;
    static void check(String name, boolean ok) {
        checks++;
        if (ok) System.out.println("ok   " + name); else { failures++; System.out.println("FAIL " + name); }
    }
    static boolean isOff(Approval a) { return !a.enabled && a.grantedAt == 0 && a.expiresAt == 0; }
    static Set<String> set(String... xs) { return new TreeSet<>(Arrays.asList(xs)); }

    public static void main(String[] args) {
        Approval g = UpdateApprovalRecord.grant(NOW, true, set());
        check("grant is on for exactly 90 days", g.enabled && g.grantedAt == NOW && g.expiresAt == NOW + UpdatePolicy.MAX_APPROVAL_SECONDS && g.unmeteredOnly);
        check("grant passes the policy's own approval check", UpdatePolicy.approvalRefusals(g, "network.itonami.torihiki", NOW).isEmpty());
        check("grant with a bad time is off", isOff(UpdateApprovalRecord.grant(0, true, set())));
        check("grant with a bad excluded id is off", isOff(UpdateApprovalRecord.grant(NOW, true, set("Not;An;Id"))));

        Approval x = UpdateApprovalRecord.exclude(g, "network.itonami.torihiki");
        check("exclude adds the id", x.excludedApps.contains("network.itonami.torihiki") && x.enabled);
        check("excluded app is refused by the policy", UpdatePolicy.approvalRefusals(x, "network.itonami.torihiki", NOW).contains("app-excluded"));
        check("exclude ignores a malformed id", UpdateApprovalRecord.exclude(g, "../x") == g);
        Approval in = UpdateApprovalRecord.include(x, "network.itonami.torihiki");
        check("include removes the id", !in.excludedApps.contains("network.itonami.torihiki") && in.enabled);

        Approval r = UpdateApprovalRecord.revoke(x);
        check("revoke is off and keeps the exclusions", isOff(r) && r.excludedApps.contains("network.itonami.torihiki"));
        check("revoked approval is refused", UpdatePolicy.approvalRefusals(r, "network.itonami.yotei", NOW).contains("approval-off"));

        String e = UpdateApprovalRecord.encode(x);
        Approval d = UpdateApprovalRecord.decode(e);
        check("encode/decode round trip: " + e, d.enabled == x.enabled && d.grantedAt == x.grantedAt && d.expiresAt == x.expiresAt
                && d.unmeteredOnly == x.unmeteredOnly && d.excludedApps.equals(x.excludedApps));
        check("round trip of off", isOff(UpdateApprovalRecord.decode(UpdateApprovalRecord.encode(UpdateApprovalRecord.off()))));

        String[] bad = { null, "", "v2|1|1|2|1|", "v1|1|1|2|1", "v1|2|1|2|1|", "v1|1|x|2|1|", "v1|1|5|5|1|",
                "v1|1|5|" + (5 + UpdatePolicy.MAX_APPROVAL_SECONDS + 1) + "|1|", "v1|1|5|6|1|Bad.Id", "v1|1|5|6|1|a.b,,c.d",
                "v1|1|-5|6|1|", "v1|1|5|6|7|" };
        for (String s : bad) check("malformed is off: " + s, isOff(UpdateApprovalRecord.decode(s)));

        Set<String> many = new TreeSet<>();
        for (int i = 0; i < UpdateApprovalRecord.MAX_EXCLUDED; i++) many.add("network.itonami.app" + (char) ('a' + i % 26) + (char) ('a' + i / 26));
        Approval full = UpdateApprovalRecord.grant(NOW, true, many);
        check("64 exclusions are kept", full.enabled && full.excludedApps.size() == 64);
        check("a 65th exclusion turns the approval off", isOff(UpdateApprovalRecord.exclude(full, "network.itonami.extra")));

        System.out.println(checks + " checks, " + failures + " failures");
        if (failures > 0) System.exit(1);
    }
}
