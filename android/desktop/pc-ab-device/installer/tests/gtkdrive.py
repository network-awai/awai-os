"""Drive the real GTK widget tree offscreen (Gtk.OffscreenWindow: nothing is ever shown on a display) with the fake world.
Keys are simulated at widget level (Tab = focus traversal, Enter/Space = activate the focused button, typing = entry text);
the physical keyboard, X and the missing window manager are covered by the VM run."""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fakes  # noqa: E402
import controller  # noqa: E402
import gui  # noqa: E402


# The bundled fonts must be registered before Gtk is imported anywhere in the process (the font map is built at import).
import tempfile  # noqa: E402
_FONT_WORK = tempfile.mkdtemp(prefix="awai-fc-")
gui.use_bundled_fonts(_FONT_WORK)


def have_gtk():
    try:
        import gi
        gi.require_version("Gtk", "3.0")
        from gi.repository import Gtk  # noqa: F401
        return True
    except Exception:
        return False


class Drive:
    def __init__(self, width=1280, height=720, world=None):
        self.w = world or fakes.World()
        self.c = controller.Controller(self.w.host, str(self.w.work), str(self.w.media), worker_cmd=fakes.worker_cmd(self.w))
        self.c.refresh()
        self.c.sync()
        import gi
        gi.require_version("Gtk", "3.0")
        from gi.repository import Gtk
        self.Gtk = Gtk
        self.ui = gui.InstallerUI(self.c, width, height)
        self.win = Gtk.OffscreenWindow()
        self.win.set_default_size(width, height)
        self.win.add(self.ui.root)
        self.ui.render(force=True)
        self.win.show_all()
        self.spin()
        gui.ensure_toplevel_focus(self.win)  # the same helper the real window uses
        self.win.set_focus(None)

    def spin(self, n=25, settle=0.12):
        """Run the main loop long enough for the frame clock to redraw (a stale offscreen pixbuf otherwise)."""
        end = time.time() + settle
        while True:
            for _ in range(n):
                while self.Gtk.events_pending():
                    self.Gtk.main_iteration()
            if time.time() >= end:
                break
            time.sleep(0.01)

    def focus(self):
        return self.win.get_focus()

    def focus_text(self):
        f = self.focus()
        if f is None:
            return None
        if isinstance(f, self.Gtk.Button):
            child = f.get_child()
            if isinstance(child, self.Gtk.Label):
                return child.get_text()
            texts = [l.get_text() for l in self.labels(f)]
            return " | ".join(texts)
        if isinstance(f, self.Gtk.Entry):
            return "typed"
        if isinstance(f, self.Gtk.Label):
            return f.get_text()
        return type(f).__name__

    def labels(self, widget=None):
        out = []

        def walk(w):
            if isinstance(w, self.Gtk.Label):
                out.append(w)
            if isinstance(w, self.Gtk.Container):
                for c in w.get_children():
                    walk(c)
        walk(widget or self.ui.root)
        return out

    def text(self):
        return "\n".join(l.get_text() for l in self.labels() if l.get_text())

    def key(self, name):
        if name == "Tab":
            self.win.child_focus(self.Gtk.DirectionType.TAB_FORWARD)
        elif name == "Shift+Tab":
            self.win.child_focus(self.Gtk.DirectionType.TAB_BACKWARD)
        elif name in ("Enter", "Space"):
            f = self.focus()
            if isinstance(f, self.Gtk.Button) and f.get_sensitive():
                f.clicked()
        else:
            raise ValueError(name)
        self.spin()

    def type(self, text):
        f = self.focus()
        assert isinstance(f, self.Gtk.Entry), f
        f.set_text(f.get_text() + text)
        self.spin()

    def poll(self):
        self.ui.poll()
        self.spin()

    def button(self, label):
        for b in self.buttons():
            if self.button_text(b) == label:
                return b
        raise KeyError(label)

    def buttons(self):
        out = []

        def walk(w):
            if isinstance(w, self.Gtk.Button):
                out.append(w)
            if isinstance(w, self.Gtk.Container):
                for c in w.get_children():
                    walk(c)
        walk(self.ui.root)
        return out

    def button_text(self, b):
        return " | ".join(l.get_text() for l in self.labels(b))

    def snap(self, path):
        self.ui.render()  # only if the view changed: a forced rebuild would clear the typed text
        self.spin()
        self.win.get_pixbuf().savev(str(path), "png", [], [])

    def fonts_used(self):
        """{(family, drawn-by-the-bundled-face): glyph count} for every label, from Pango: the CSS family is the bundled one and the
        font Pango loads for it covers every character exactly."""
        import gi
        gi.require_version("Pango", "1.0")
        from gi.repository import Pango
        used = {}
        for l in self.labels():
            style = l.get_style_context()
            family = style.get_property("font-family", self.Gtk.StateFlags.NORMAL)
            weight = style.get_property("font-weight", self.Gtk.StateFlags.NORMAL)
            ctx = l.get_pango_context()
            desc = Pango.FontDescription()
            desc.set_family(family[0])
            desc.set_weight(weight)
            desc.set_size(12 * Pango.SCALE)
            font = ctx.load_font(desc)
            fam = font.describe().get_family()
            cov = font.get_coverage(Pango.Language.from_string("ja"))
            for ch in l.get_text():
                if ch.isspace():
                    continue
                key = (fam, cov.get(ord(ch)) == Pango.CoverageLevel.EXACT)
                used[key] = used.get(key, 0) + 1
        return used

    def close(self):
        self.win.destroy()
        end = time.time() + 60
        while time.time() < end and (fakes.core.lock_held(str(self.w.work)) or (self.c.proc and self.c.proc.poll() is None)):
            time.sleep(0.1)
        self.w.cleanup()
