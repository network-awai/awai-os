"""The kiosk configuration inside a real Firefox ESR, headless (no window is ever shown), driven over Marionette.
Optional: skipped unless a Firefox.app is unpacked at ~/awai-ff-test/app (or AWAI_FIREFOX_APP). The test installs
kiosk/mozilla.cfg, autoconfig.js and the policy into a private copy's Resources and removes them afterwards.
Synthetic key events reach the autoconfig's own listeners but cannot trigger Firefox's built-in shortcuts headless, so the
shortcut paths are checked at the listener (defaultPrevented) and by the programmatic equivalents (new tab, new window,
navigation to a blocked page); the QEMU run covers the physical keyboard."""
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import marionette  # noqa: E402
from scenario import Live  # noqa: E402

STATE = """const w = Services.wm.getMostRecentWindow("navigator:browser");
let wins = 0; const e = Services.wm.getEnumerator("navigator:browser"); while (e.hasMoreElements()) { e.getNext(); wins++; }
const b = w.gBrowser.selectedBrowser; const sh = b.browsingContext.sessionHistory; const hist = [];
for (let i = 0; i < sh.count; i++) hist.push(sh.getEntryAtIndex(i).URI.spec);
const h = (id) => { const x = w.document.getElementById(id); return x ? x.getBoundingClientRect().height : -1; };
return {wins, tabs: w.gBrowser.tabs.length, url: b.currentURI.spec, title: b.contentTitle, fs: w.fullScreen, toolbox: h("navigator-toolbox"),
  nav: h("nav-bar"), tabstrip: h("TabsToolbar"), hist,
  enabledKeys: Array.from(w.document.querySelectorAll("key:not([disabled])")).map(k => k.id).filter(Boolean)}"""
SYNTH = """const w = Services.wm.getMostRecentWindow("navigator:browser");
const out = {};
for (const [name, key, ctrl, alt] of arguments[0]) {
  const ev = new w.KeyboardEvent("keydown", {key, ctrlKey: ctrl, altKey: alt, bubbles: true, cancelable: true});
  w.document.documentElement.dispatchEvent(ev); out[name] = ev.defaultPrevented;
}
return out;"""
SYSTEM = 'const w = Services.wm.getMostRecentWindow("navigator:browser"); const p = Services.scriptSecurityManager.getSystemPrincipal(); '


@unittest.skipUnless(marionette.app_path(), "no unpacked Firefox ESR (set AWAI_FIREFOX_APP or unpack to ~/awai-ff-test/app)")
class KioskInRealFirefox(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.live = Live()
        cls.ff = marionette.Firefox(str(cls.live.w.work), "file://" + cls.live.launch)
        cls.c = cls.ff.client
        cls.token = cls.live.app.token

    @classmethod
    def tearDownClass(cls):
        cls.ff.close()
        cls.live.close()

    def state(self):
        return self.c.chrome(STATE)

    def settle(self, check, timeout=15):
        end = time.time() + timeout
        while time.time() < end:
            st = self.state()
            if check(st):
                return st
            time.sleep(0.3)
        self.fail(f"did not settle: {st}")

    def page_text(self):
        self.c.call("Marionette:SetContext", value="content")
        try:
            return self.c.call("WebDriver:ExecuteScript", script="return document.body ? document.body.innerText : ''", args=[])["value"] or ""
        except RuntimeError:  # the page is being replaced
            return ""
        finally:
            self.c.call("Marionette:SetContext", value="chrome")

    def wait_text(self, needle, timeout=20):
        end = time.time() + timeout
        text = ""
        while time.time() < end:
            text = self.page_text()
            if needle in text:
                return text
            time.sleep(0.4)
        self.fail(f"{needle!r} never appeared in {text!r}")

    def installer_shown(self, st):
        return st["tabs"] == 1 and st["wins"] == 1 and st["url"].startswith("http://127.0.0.1:") and st["title"] == "Awai OS Meiji"

    def test_01_starts_full_screen_without_chrome_on_the_installer_and_without_the_token_in_the_url(self):
        st = self.settle(self.installer_shown)
        self.assertTrue(st["fs"], st)
        for part in ("toolbox", "nav", "tabstrip"):
            self.assertLessEqual(st[part], 0, (part, st))
        self.assertNotIn("#", st["url"])
        for entry in st["hist"]:
            self.assertNotIn(self.token, entry)
        self.assertNotIn(self.token, st["url"])
        self.wait_text("インストール先を選ぶ")
        self.assertLessEqual(len(st["enabledKeys"]), 6, st["enabledKeys"])

    def test_02_shortcut_keys_are_swallowed_and_ordinary_keys_are_not(self):
        keys = [("ctrl+t", "t", True, False), ("ctrl+n", "n", True, False), ("ctrl+l", "l", True, False), ("ctrl+o", "o", True, False),
                ("ctrl+w", "w", True, False), ("ctrl+shift+i", "I", True, False), ("f12", "F12", False, False), ("f6", "F6", False, False),
                ("alt+left", "ArrowLeft", False, True), ("f11", "F11", False, False), ("menu", "ContextMenu", False, False),
                ("tab", "Tab", False, False), ("enter", "Enter", False, False), ("a", "a", False, False), ("space", " ", False, False)]
        result = self.c.chrome(SYNTH, keys)
        for name in ("ctrl+t", "ctrl+n", "ctrl+l", "ctrl+o", "ctrl+w", "ctrl+shift+i", "f12", "f6", "alt+left", "f11", "menu"):
            self.assertTrue(result[name], f"{name} must be swallowed: {result}")
        for name in ("tab", "enter", "a", "space"):
            self.assertFalse(result[name], f"{name} must reach the page: {result}")
        self.settle(self.installer_shown)

    def test_03_new_tab_new_window_and_foreign_pages_return_to_the_installer(self):
        self.c.chrome(SYSTEM + 'w.gBrowser.addTab("about:newtab", {triggeringPrincipal: p});')
        self.settle(self.installer_shown)
        self.c.chrome(SYSTEM + 'w.OpenBrowserWindow();')
        st = self.settle(lambda s: s["wins"] == 1 and self.installer_shown(s))
        for url in ("https://example.com/", "about:config", "about:blank", "about:newtab", "about:preferences"):
            self.c.chrome(SYSTEM + 'w.gBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal: p});', url)
            st = self.settle(self.installer_shown)
            self.assertTrue(st["fs"] and st["toolbox"] <= 0, (url, st))
        self.wait_text("インストール先")

    def test_04_f5_returns_through_the_launch_page_and_the_page_works_again(self):
        self.c.chrome(SYSTEM + 'w.gBrowser.loadURI(Services.io.newURI("about:blank"), {triggeringPrincipal: p});')
        self.c.chrome(SYNTH, [("f5", "F5", False, False)])
        st = self.settle(self.installer_shown)
        self.assertNotIn("#", st["url"])
        self.wait_text("インストール先を選ぶ")

    def test_05_a_page_that_lost_its_token_is_sent_back_through_the_launch_page(self):
        self.c.call("Marionette:SetContext", value="content")
        self.c.call("WebDriver:ExecuteScript", script="sessionStorage.clear(); location.reload();", args=[])
        self.c.call("Marionette:SetContext", value="chrome")
        self.settle(lambda s: self.installer_shown(s))
        self.wait_text("インストール先を選ぶ")


if __name__ == "__main__":
    unittest.main()
