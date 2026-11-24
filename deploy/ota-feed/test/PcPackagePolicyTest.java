package org.lineageos.updater.controller;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public class PcPackagePolicyTest {
    private static final String SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    private static int tests;

    private static void expect(boolean actual, boolean expected, String label) {
        if (actual != expected) {
            throw new AssertionError(label + " expected " + expected);
        }
        tests++;
    }

    public static void main(String[] args) throws Exception {
        String repo = "/network-awai/awai-os/";
        String assetPath = repo + "releases/download/pilot-1/" + SHA256 + ".zip";
        String release = "https://github.com" + assetPath;
        String rawHost = "https://raw.githubusercontent.com";
        String commit = "a".repeat(40);
        String raw = rawHost + repo + commit + "/dist/pilot.zip";

        expect(PcPackagePolicy.isAllowed(release, SHA256), true, "release asset");
        expect(PcPackagePolicy.isAllowed(raw, SHA256), true, "raw commit");
        expect(PcPackagePolicy.isAllowed("https://ota.awai.network/v1/pc/pilot/legacy.zip", SHA256),
                true, "legacy origin");
        expect(PcPackagePolicy.isAllowed("http://github.com" + assetPath, SHA256), false, "HTTP");
        expect(PcPackagePolicy.isAllowed("https://github.com.invalid" + assetPath, SHA256), false, "other host");
        expect(PcPackagePolicy.isAllowed("https://user@github.com" + assetPath, SHA256), false, "userinfo");
        expect(PcPackagePolicy.isAllowed("https://github.com:4430" + assetPath, SHA256), false, "port");
        expect(PcPackagePolicy.isAllowed(release + "?", SHA256), false, "empty query");
        expect(PcPackagePolicy.isAllowed(release + "?x=y", SHA256), false, "query");
        expect(PcPackagePolicy.isAllowed(release + "#", SHA256), false, "empty fragment");
        expect(PcPackagePolicy.isAllowed(raw + "#section", SHA256), false, "raw fragment");
        expect(PcPackagePolicy.isAllowed(rawHost + repo + "deadbeef/pilot.zip", SHA256), false, "short commit");
        expect(PcPackagePolicy.isAllowed(rawHost + repo + "z".repeat(40) + "/pilot.zip", SHA256), false, "non-hex commit");
        expect(PcPackagePolicy.isAllowed(rawHost + repo + commit + "/../pilot.zip", SHA256), false, "raw traversal");
        expect(PcPackagePolicy.isAllowed(rawHost + repo + commit + "/dist/..", SHA256), false, "raw parent suffix");
        expect(PcPackagePolicy.isAllowed(rawHost + repo + commit + "/%2e%2e/pilot.zip", SHA256), false, "encoded path");
        expect(PcPackagePolicy.isAllowed(release.replace("pilot-1", ".."), SHA256), false, "release traversal");
        expect(PcPackagePolicy.isAllowed(release.replace(repo, "/another/awai-os/"), SHA256), false, "other repo");
        expect(PcPackagePolicy.isAllowed(release, "b".repeat(64)), false, "release name must bind index digest");
        expect(PcPackagePolicy.isAllowed(raw, "no-digest"), false, "raw must name a valid index digest");
        expect(PcPackagePolicy.isAllowed("https://release-assets.githubusercontent.com/asset?se=test", SHA256),
                false, "temporary CDN URL cannot be published in index");

        Path zip = Files.createTempFile("awai-policy-test", ".zip");
        try {
            Files.write(zip, "abc".getBytes(StandardCharsets.UTF_8));
            expect(PcPackagePolicy.matchesDigest(zip.toFile(), SHA256), true, "file matches expected digest");
            Files.write(zip, "abd".getBytes(StandardCharsets.UTF_8));
            expect(PcPackagePolicy.matchesDigest(zip.toFile(), SHA256), false, "tampered file");
        } finally {
            Files.delete(zip);
        }
        System.out.println("Updater package policy: " + tests + " passed");
    }
}
