package network.awai.platform;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Whether a Store update may be installed without asking (AWAI-3660).
 *
 * <p>This implements the eligibility conditions of the standing update approval in the end-user
 * app environment contract (kotoba-lang/kotoba#1365,
 * {@code lib/kotoba.wasmWebcomponent/docs/client-runtime-standing-update-proposal.md}). It is a
 * pure decision: no Android types, no I/O, no network, and it grants nothing. The caller collects
 * every fact from verified sources (the authenticated catalog, the hashed APK, PackageManager) and
 * passes it in. Unknown or missing facts are refusals. An update with any refusal is not applied
 * automatically; it stays an ordinary update that waits for the person's approval.
 */
public final class UpdatePolicy {
    private UpdatePolicy() {}

    /** The longest standing approval: 90 days (proposal Decision 4). */
    public static final long MAX_APPROVAL_SECONDS = 90L * 24 * 60 * 60;

    private static final Pattern DIGEST = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern PACKAGE = Pattern.compile("[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*)+");

    /** The person's standing update approval, as held by the host. */
    public static final class Approval {
        public final boolean enabled;
        public final long grantedAt;
        public final long expiresAt;
        public final Set<String> excludedApps;
        public final boolean unmeteredOnly;

        public Approval(boolean enabled, long grantedAt, long expiresAt, Set<String> excludedApps,
                        boolean unmeteredOnly) {
            this.enabled = enabled;
            this.grantedAt = grantedAt;
            this.expiresAt = expiresAt;
            this.excludedApps = excludedApps;
            this.unmeteredOnly = unmeteredOnly;
        }
    }

    /** The installed version, read from PackageManager and the host's install record. */
    public static final class Installed {
        public final String packageName;
        public final long versionCode;
        public final String signerSha256;
        public final boolean installedByThisStore;
        public final Set<String> permissions;
        /** Declared external operations, or null when unknown. */
        public final Set<String> operations;

        public Installed(String packageName, long versionCode, String signerSha256,
                         boolean installedByThisStore, Set<String> permissions, Set<String> operations) {
            this.packageName = packageName;
            this.versionCode = versionCode;
            this.signerSha256 = signerSha256;
            this.installedByThisStore = installedByThisStore;
            this.permissions = permissions;
            this.operations = operations;
        }
    }

    /** The candidate update: catalog facts, and facts read from the downloaded, hashed APK. */
    public static final class Candidate {
        public final boolean catalogSignatureVerified;
        public final long catalogRevision;
        public final long catalogExpiresAt;
        public final String packageName;
        public final long versionCode;
        public final String signerSha256;
        public final long bytes;
        public final boolean digestMatches;
        public final Set<String> permissions;
        /** Declared external operations, or null when unknown. */
        public final Set<String> operations;

        public Candidate(boolean catalogSignatureVerified, long catalogRevision, long catalogExpiresAt,
                         String packageName, long versionCode, String signerSha256, long bytes,
                         boolean digestMatches, Set<String> permissions, Set<String> operations) {
            this.catalogSignatureVerified = catalogSignatureVerified;
            this.catalogRevision = catalogRevision;
            this.catalogExpiresAt = catalogExpiresAt;
            this.packageName = packageName;
            this.versionCode = versionCode;
            this.signerSha256 = signerSha256;
            this.bytes = bytes;
            this.digestMatches = digestMatches;
            this.permissions = permissions;
            this.operations = operations;
        }
    }

    /** Device and budget state at the time of the decision. */
    public static final class Device {
        public final long now;
        public final long admittedRevision;
        public final long appByteBudget;
        public final long bytesUsedToday;
        public final long dailyByteBudget;
        public final boolean networkUnmetered;

        public Device(long now, long admittedRevision, long appByteBudget, long bytesUsedToday,
                       long dailyByteBudget, boolean networkUnmetered) {
            this.now = now;
            this.admittedRevision = admittedRevision;
            this.appByteBudget = appByteBudget;
            this.bytesUsedToday = bytesUsedToday;
            this.dailyByteBudget = dailyByteBudget;
            this.networkUnmetered = networkUnmetered;
        }
    }

    /** Whether the approval itself is in force now (it says nothing about any update). */
    public static List<String> approvalRefusals(Approval a, String packageName, long now) {
        List<String> r = new ArrayList<>();
        if (a == null || !a.enabled) { r.add("approval-off"); return r; }
        if (now <= 0 || a.grantedAt <= 0 || a.grantedAt > now) r.add("approval-time");
        if (a.expiresAt <= a.grantedAt || a.expiresAt - a.grantedAt > MAX_APPROVAL_SECONDS)
            r.add("approval-period");
        if (a.expiresAt <= now) r.add("approval-expired");
        if (a.excludedApps == null || packageName == null || a.excludedApps.contains(packageName))
            r.add("app-excluded");
        return r;
    }

    /**
     * Every reason this update may not be installed without asking; empty means eligible.
     * The codes are stable, so the host can log and show them.
     */
    public static List<String> refusals(Approval a, Installed i, Candidate c, Device x) {
        if (i == null || c == null || x == null) return Collections.singletonList("missing-facts");
        List<String> r = approvalRefusals(a, i.packageName, x.now);
        // 1. Catalog: authentic, not rolled back, not expired.
        if (!c.catalogSignatureVerified) r.add("catalog-signature");
        if (c.catalogRevision < 1 || c.catalogRevision < x.admittedRevision) r.add("catalog-rollback");
        if (c.catalogExpiresAt <= x.now) r.add("catalog-expired");
        // 2. Same app, same signer, strictly newer, installed by this Store.
        if (i.packageName == null || !PACKAGE.matcher(i.packageName).matches()
                || !i.packageName.equals(c.packageName)) r.add("package-changed");
        if (!i.installedByThisStore) r.add("not-installed-by-store");
        if (!digest(i.signerSha256) || !digest(c.signerSha256) || !i.signerSha256.equals(c.signerSha256))
            r.add("signer-changed");
        if (i.versionCode < 1 || c.versionCode <= i.versionCode) r.add("not-newer");
        // 3. Artifact digest and size, as checked against the catalog entry.
        if (!c.digestMatches) r.add("digest");
        // 4. No new Android permission.
        if (i.permissions == null || c.permissions == null || !addedPermissions(i.permissions, c.permissions).isEmpty())
            r.add("new-permission");
        // 5. No new external operation, endpoint origin or data category.
        if (i.operations == null || c.operations == null) r.add("operations-unknown");
        else if (!i.operations.containsAll(c.operations)) r.add("new-operation");
        // 6. Byte budgets, per app and per day.
        if (c.bytes < 1 || x.appByteBudget < 1 || c.bytes > x.appByteBudget) r.add("app-budget");
        if (x.dailyByteBudget < 1 || x.bytesUsedToday < 0
                || x.bytesUsedToday > x.dailyByteBudget - Math.max(c.bytes, 0)) r.add("daily-budget");
        // 7. Network condition the person chose.
        if (a != null && a.unmeteredOnly && !x.networkUnmetered) r.add("network-metered");
        return r;
    }

    /**
     * Android permissions the candidate requests that the installed version does not, sorted.
     * The Store shows this list on the update screen instead of a fixed sentence (AWAI-3653).
     */
    public static List<String> addedPermissions(Set<String> installed, Set<String> candidate) {
        List<String> out = new ArrayList<>();
        for (String p : candidate) if (!installed.contains(p)) out.add(p);
        Collections.sort(out);
        return out;
    }

    public static boolean eligible(Approval a, Installed i, Candidate c, Device x) {
        return refusals(a, i, c, x).isEmpty();
    }

    private static boolean digest(String s) {
        return s != null && DIGEST.matcher(s).matches();
    }
}
