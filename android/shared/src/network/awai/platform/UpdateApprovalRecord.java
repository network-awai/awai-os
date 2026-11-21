package network.awai.platform;

import java.util.Collections;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * The stored form of the standing update approval (AWAI-3653, step 2).
 *
 * <p>Pure Java: no Android types. The host keeps the encoded value in host-private storage and is
 * the only writer. {@link #grant} and {@link #include} broaden the approval, so the host calls them
 * only after the person pressed Allow in a native dialog. {@link #revoke} and {@link #exclude}
 * narrow it and may run directly. A value that does not decode exactly is treated as off.
 */
public final class UpdateApprovalRecord {
    private UpdateApprovalRecord() {}

    public static final int MAX_EXCLUDED = 64;
    private static final Pattern PACKAGE = Pattern.compile("[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*)+");

    public static UpdatePolicy.Approval off() {
        return new UpdatePolicy.Approval(false, 0, 0, Collections.<String>emptySet(), true);
    }

    /** A new approval chosen by the person at {@code now}: on, for the longest allowed period. */
    public static UpdatePolicy.Approval grant(long now, boolean unmeteredOnly, Set<String> excluded) {
        if (now <= 0) return off();
        Set<String> kept = validIds(excluded);
        if (kept == null) return off();
        return new UpdatePolicy.Approval(true, now, now + UpdatePolicy.MAX_APPROVAL_SECONDS, kept, unmeteredOnly);
    }

    public static UpdatePolicy.Approval revoke(UpdatePolicy.Approval current) {
        Set<String> kept = current == null ? null : validIds(current.excludedApps);
        return new UpdatePolicy.Approval(false, 0, 0, kept == null ? Collections.<String>emptySet() : kept, true);
    }

    /** Narrowing: the app is no longer updated without asking. */
    public static UpdatePolicy.Approval exclude(UpdatePolicy.Approval a, String id) {
        if (a == null || !PACKAGE.matcher(String.valueOf(id)).matches()) return a;
        Set<String> next = new TreeSet<>(a.excludedApps == null ? Collections.<String>emptySet() : a.excludedApps);
        next.add(id);
        if (next.size() > MAX_EXCLUDED) return revoke(a);
        return new UpdatePolicy.Approval(a.enabled, a.grantedAt, a.expiresAt, Collections.unmodifiableSet(next), a.unmeteredOnly);
    }

    /** Broadening: only after the person confirmed it in host UI. */
    public static UpdatePolicy.Approval include(UpdatePolicy.Approval a, String id) {
        if (a == null || a.excludedApps == null) return a;
        Set<String> next = new TreeSet<>(a.excludedApps);
        next.remove(id);
        return new UpdatePolicy.Approval(a.enabled, a.grantedAt, a.expiresAt, Collections.unmodifiableSet(next), a.unmeteredOnly);
    }

    /** {@code v1|enabled|grantedAt|expiresAt|unmetered|id,id} */
    public static String encode(UpdatePolicy.Approval a) {
        if (a == null) a = off();
        Set<String> ids = validIds(a.excludedApps);
        StringBuilder s = new StringBuilder("v1|").append(a.enabled ? 1 : 0).append('|').append(a.grantedAt)
                .append('|').append(a.expiresAt).append('|').append(a.unmeteredOnly ? 1 : 0).append('|');
        boolean first = true;
        for (String id : ids == null ? Collections.<String>emptySet() : ids) {
            if (!first) s.append(',');
            s.append(id);
            first = false;
        }
        return s.toString();
    }

    public static UpdatePolicy.Approval decode(String s) {
        if (s == null || s.length() > 8192) return off();
        String[] f = s.split("\\|", -1);
        if (f.length != 6 || !"v1".equals(f[0]) || !bit(f[1]) || !bit(f[4])) return off();
        long granted, expires;
        try { granted = Long.parseLong(f[2]); expires = Long.parseLong(f[3]); }
        catch (NumberFormatException bad) { return off(); }
        Set<String> ids = new TreeSet<>();
        if (!f[5].isEmpty()) for (String id : f[5].split(",", -1)) ids.add(id);
        Set<String> kept = validIds(ids);
        if (kept == null) return off();
        boolean enabled = "1".equals(f[1]);
        if (enabled && (granted <= 0 || expires <= granted || expires - granted > UpdatePolicy.MAX_APPROVAL_SECONDS))
            return off();
        return new UpdatePolicy.Approval(enabled, enabled ? granted : 0, enabled ? expires : 0, kept, "1".equals(f[4]));
    }

    private static boolean bit(String s) { return "0".equals(s) || "1".equals(s); }

    private static Set<String> validIds(Set<String> ids) {
        if (ids == null || ids.size() > MAX_EXCLUDED) return null;
        Set<String> out = new TreeSet<>();
        for (String id : ids) {
            if (id == null || id.length() > 128 || !PACKAGE.matcher(id).matches()) return null;
            out.add(id);
        }
        return Collections.unmodifiableSet(out);
    }
}
