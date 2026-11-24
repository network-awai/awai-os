#!/usr/bin/env python3
"""GTK 3 front end of the Awai OS PC installer (one process, no listener, no browser, no window manager needed).

  gui.py [--work-dir DIR] [--media-dir DIR]

It renders controller.Controller.view() and forwards events. The install itself runs in the detached core.py worker, so
closing or killing this process never stops a write; start.sh starts it again and it shows the true state.
Proportions follow design/installer.png: one design unit u = min(W/740, H/440) pixels.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def use_bundled_fonts(work):
    """Make the bundled Noto Sans JP visible to this process only (a private fontconfig file; system config is still included)."""
    conf = os.path.join(work, "fonts.conf")
    os.makedirs(work, mode=0o700, exist_ok=True)
    with open(conf, "w") as f:
        f.write('<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n'
                '<include ignore_missing="yes">/etc/fonts/fonts.conf</include>\n'
                f'<dir>{os.path.join(HERE, "fonts")}</dir>\n<cachedir>{os.path.join(work, "fc-cache")}</cachedir>\n</fontconfig>\n')
    os.environ["FONTCONFIG_FILE"] = conf
    os.environ.setdefault("PANGOCAIRO_BACKEND", "fc")


def ensure_toplevel_focus(win):
    """Without a window manager nobody tells GTK that its window has the keyboard focus, and GTK then ignores Tab traversal.
    Tell it: give the X window the input focus and mark the GTK toplevel as focused (idempotent)."""
    import gi
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk
    gw = win.get_window()
    if gw is not None and type(win).__name__ != "OffscreenWindow":  # an offscreen window has no X window to focus
        try:
            gw.focus(Gdk.CURRENT_TIME)
        except Exception:
            pass
    if not win.has_toplevel_focus() and gw is not None:
        ev = Gdk.Event.new(Gdk.EventType.FOCUS_CHANGE)
        ev.window = gw
        ev.focus_change.window = gw
        ev.focus_change._in = 1
        win.emit("focus-in-event", ev)


def css_for(u):
    """Gtk CSS for one design unit u (pixels). Same colours and sizes as the approved design."""
    p = lambda n: f"{max(1, round(n * u))}px"
    return f"""
* {{ font-family: "Noto Sans JP"; color: #1b2433; }}
window, .app {{ background: #ffffff; }}
.rail {{ background: #f2f4f8; padding: {p(37)} {p(31)} {p(24)} {p(31)}; }}
.logo {{ border-radius: {p(7)}; }}
.release {{ font-size: {p(12)}; font-weight: 500; }}
.product {{ font-size: {p(22)}; font-weight: 500; }}
.step {{ font-size: {p(11.5)}; color: #5b6678; }}
.step-current, .step-current label {{ color: #1d4fa3; font-weight: 700; }}
.step-tag {{ font-size: {p(9)}; font-weight: 400; color: #5b6678; }}
.step-current .step-tag {{ color: #1d4fa3; font-weight: 400; }}
.hint {{ font-size: {p(9.5)}; color: #5b6678; }}
.hintrule {{ background: #d9dee7; min-height: 1px; }}
.title {{ font-size: {p(26)}; font-weight: 500; }}
.title:focus {{ outline: none; }}
.sub {{ font-size: {p(11.5)}; color: #5b6678; }}
.caption {{ font-size: {p(9.5)}; color: #5b6678; }}
.footrule {{ background: #d9dee7; min-height: 1px; }}
button {{ background-image: none; box-shadow: none; text-shadow: none; border-radius: 0; border: 0; background: transparent; padding: 0; margin: 0; }}
button:focus {{ outline-style: solid; outline-width: 3px; outline-color: #f0a000; outline-offset: 2px; }}
button.card {{ background: #ffffff; border: 1px solid #d9dee7; border-radius: {p(11)}; padding: {p(8)} 0 {p(8)} {p(14)}; min-height: {p(39)}; }}
button.card.selected {{ background: #e3ebfd; border-color: #8fa9e8; }}
box.card {{ background: #f1f3f6; border: 1px solid #d9dee7; border-radius: {p(11)}; padding: {p(8)} 0 {p(8)} {p(14)}; min-height: {p(39)}; }}
box.card.selected {{ background: #e3ebfd; border-color: #8fa9e8; }}
.card-title {{ font-size: {p(14)}; font-weight: 500; }}
.card-sub {{ font-size: {p(9.5)}; color: #5b6678; }}
.card-tag {{ font-size: {p(11.5)}; }}
.selected .card-tag {{ color: #1d4fa3; }}
.note {{ background: #f1f3f6; border-radius: {p(11)}; padding: {p(14)}; }}
.note-err {{ background: #fde3e1; }}
.note-title {{ font-size: {p(12)}; font-weight: 500; }}
.note-err .note-title {{ color: #8a1f17; }}
.note-body {{ font-size: {p(9.5)}; color: #5b6678; }}
.note-err .note-body {{ color: #7a3b36; }}
.alert {{ font-size: {p(9.5)}; color: #8a1f17; }}
button.btn {{ background: #1d4fa3; border-radius: 999px; min-width: {p(111)}; min-height: {p(28)}; padding: 0 {p(16)}; }}
button.btn label {{ color: #ffffff; font-size: {p(9.5)}; font-weight: 700; }}
button.btn:disabled {{ background: #e8ebf0; }}
button.btn:disabled label {{ color: #5b6678; }}
button.link {{ padding: {p(8)} {p(30)}; }}
button.link label {{ color: #1d4fa3; font-size: {p(9.5)}; }}
button.link:disabled label {{ color: #8791a1; }}
entry {{ font-size: {p(14)}; padding: {p(7)} {p(12)}; border: 2px solid #d9dee7; border-radius: {p(9)}; background: #ffffff; box-shadow: none; min-height: 0; }}
entry:focus {{ outline-style: solid; outline-width: 3px; outline-color: #f0a000; outline-offset: 2px; border-color: #d9dee7; }}
.confirm-q {{ font-size: {p(11)}; }}
.stepline {{ font-size: {p(9.5)}; color: #5b6678; }}
.stepline-active, .stepline-active label {{ font-size: {p(12.5)}; font-weight: 700; color: #1d4fa3; }}
.pct {{ font-size: {p(9)}; color: #5b6678; }}
progressbar trough {{ background: #dfe4ec; border: 0; border-radius: {p(2)}; min-height: {p(4)}; }}
progressbar progress {{ background: #1d4fa3; border: 0; border-radius: {p(2)}; min-height: {p(4)}; }}
"""


class InstallerUI:
    """The widget tree. `root` goes into a Gtk.Window (gui.main) or a Gtk.OffscreenWindow (tests, screenshots)."""

    def __init__(self, controller, width, height):
        import gi
        gi.require_version("Gtk", "3.0")
        gi.require_version("Gdk", "3.0")
        from gi.repository import Gdk, GdkPixbuf, GLib, Gtk, Pango
        self.Gtk, self.Gdk, self.GLib, self.Pango = Gtk, Gdk, GLib, Pango
        self.c, self.W, self.H = controller, width, height
        self.u = min(width / 740, height / 440)
        self.widgets = {}
        self.last_key = None
        settings = Gtk.Settings.get_default()
        for name, value in (("gtk-enable-mnemonics", False), ("gtk-enable-accels", False), ("gtk-menu-bar-accel", ""),
                            ("gtk-xft-dpi", 96 * 1024), ("gtk-cursor-blink", False), ("gtk-enable-animations", False)):
            try:
                settings.set_property(name, value)
            except Exception:
                pass
        provider = Gtk.CssProvider()
        provider.load_from_data(css_for(self.u).encode())
        Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_USER)
        self.root = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        self.root.get_style_context().add_class("app")
        self.root.set_size_request(width, height)
        u = self.u
        self.rail = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.rail.get_style_context().add_class("rail")
        self.rail.set_size_request(round(0.305 * width), -1)
        self.main = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.main.set_margin_start(round(0.054 * width))
        self.main.set_margin_top(round(46 * u))
        self.main.set_margin_bottom(round(20 * u))
        self.root.pack_start(self.rail, False, False, 0)
        self.root.pack_start(self.main, True, True, 0)
        pix = GdkPixbuf.Pixbuf.new_from_file_at_scale(os.path.join(HERE, "assets", "logo.png"), round(35 * u), round(35 * u), True)
        self.logo = Gtk.Image.new_from_pixbuf(pix)
        self.logo.set_halign(Gtk.Align.START)
        self.logo.get_style_context().add_class("logo")
        self.steps_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=round(14 * u))
        self.title = self.label("", "title", wrap=True)
        self.sub = self.label("", "sub", wrap=True)
        self.body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.body.set_size_request(round(0.577 * width), -1)
        self.body.set_halign(Gtk.Align.START)
        self.actions = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        self.actions.set_size_request(round(0.614 * width), -1)
        self.actions.set_halign(Gtk.Align.START)
        self.build_rail()
        rule = Gtk.Box()
        rule.get_style_context().add_class("footrule")
        rule.set_size_request(round(0.614 * width), 1)
        rule.set_halign(Gtk.Align.START)
        self.actions_rule = rule
        self.main.pack_start(self.title, False, False, 0)
        self.main.pack_start(self.sub, False, False, 0)
        self.main.pack_start(self.body, True, True, 0)
        self.main.pack_start(rule, False, False, round(12 * u))
        self.main.pack_start(self.actions, False, False, round(16 * u))

    # -- helpers -------------------------------------------------------------------------------------------------------------
    def label(self, text, cls, wrap=False, xalign=0.0):
        l = self.Gtk.Label(label=text)
        l.set_xalign(xalign)
        l.set_yalign(0.0)
        l.set_line_wrap(wrap)
        if wrap:
            l.set_line_wrap_mode(self.Pango.WrapMode.WORD_CHAR)
        l.get_style_context().add_class(cls)
        return l

    def build_rail(self):
        from strings import T
        Gtk, u = self.Gtk, self.u
        self.rail.pack_start(self.logo, False, False, 0)
        rel = self.label(T["release"], "release")
        rel.set_margin_top(round(9 * u))
        self.rail.pack_start(rel, False, False, 0)
        prod = self.label(T["product"], "product")
        self.line_height(prod, round(25 * u * 1024))  # the design's line pitch: 25 units for the 22-unit font
        prod.set_margin_top(round(18 * u))
        self.rail.pack_start(prod, False, False, 0)
        self.steps_box.set_margin_top(round(34 * u))
        self.steps_box.set_margin_end(round(32 * u))
        self.rail.pack_start(self.steps_box, False, False, 0)
        hint = self.label(T["hint"], "hint")
        hint.set_margin_top(round(14 * u))
        rule = Gtk.Box()
        rule.get_style_context().add_class("hintrule")
        rule.set_size_request(-1, 1)
        self.rail.pack_end(hint, False, False, 0)
        self.rail.pack_end(rule, False, False, 0)

    def line_height(self, label, pango_units):
        """Pango >= 1.50 absolute line height (pixels * 1024); older Pango keeps its default spacing."""
        try:
            attrs = self.Pango.AttrList()
            attrs.insert(self.Pango.attr_line_height_new_absolute(pango_units))
            label.set_attributes(attrs)
        except Exception:
            pass

    def clear(self, box):
        for child in box.get_children():
            box.remove(child)
            child.destroy()

    def remember(self, key, widget):
        self.widgets[key] = widget
        widget.awai_key = key
        return widget

    # -- rendering -----------------------------------------------------------------------------------------------------------
    def render(self, force=False):
        """Rebuild from the controller's view; keep focus on the same logical widget."""
        view = self.c.view()
        key = json.dumps({k: v for k, v in view.items() if k not in ("state", "armed")}, sort_keys=True, default=str) + json.dumps(
            {k: v for k, v in view["state"].items() if k != "updatedAt"}, sort_keys=True, default=str)
        if key == self.last_key and not force:
            return
        self.last_key = key
        focused = self.root.get_toplevel().get_focus() if self.root.get_toplevel() else None
        focus_key = getattr(focused, "awai_key", None)
        screen_changed = getattr(self, "shown_screen", None) != view["screen"]
        self.shown_screen = view["screen"]
        self.widgets = {}
        self.rebuilding = True  # widgets losing focus because they are destroyed is not the user leaving a button
        for box in (self.body, self.actions):
            self.clear(box)
        getattr(self, "screen_" + view["screen"])(view)
        self.render_rail(view["rail"])
        self.root.show_all()
        top = self.root.get_toplevel()
        if not screen_changed and focus_key in self.widgets:
            self.widgets[focus_key].grab_focus()
        elif hasattr(top, "set_focus"):
            top.set_focus(None)  # like the heading in the design: nothing focused until the first Tab
        self.rebuilding = False

    def render_rail(self, active):
        from strings import T
        self.clear(self.steps_box)
        for i, name in enumerate(T["rail"]):
            row = self.Gtk.Box(orientation=self.Gtk.Orientation.HORIZONTAL)
            ctx = row.get_style_context()
            ctx.add_class("step")
            if i == active:
                ctx.add_class("step-current")
            left = self.label(name, "step")
            row.pack_start(left, True, True, 0)
            if i == active or i < active:
                row.pack_end(self.label(T["current"] if i == active else T["done"], "step-tag"), False, False, 0)
            self.steps_box.pack_start(row, False, False, 0)

    def frame(self, title, sub, body, actions):
        """actions = [left, right] visually; the Tab order puts the primary (right) first, then the left one."""
        self.title.set_text(title)
        self.sub.set_text(sub)
        self.sub.set_margin_top(round(9 * self.u))
        self.sub.set_margin_bottom(round(20 * self.u))
        for w in body:
            self.body.pack_start(w, False, False, 0)
        left, right = actions
        if left is not None:
            self.actions.pack_start(left, False, False, 0)
        if right is not None:
            self.actions.pack_end(right, False, False, 0)
        chain = [w for w in (right, left) if w is not None]  # insensitive ones are skipped by GTK itself
        self.actions.set_focus_chain(chain)

    def card(self, c, extra=None, detail=None):
        Gtk, u = self.Gtk, self.u
        sub = detail if (extra and detail is not None) else c["sub"]
        inner = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        text = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        text.pack_start(self.label(c["title"], "card-title"), False, False, 0)
        text.pack_start(self.label(sub, "card-sub"), False, False, 0)
        inner.pack_start(text, True, True, 0)
        tag = self.label(extra or c["tag"], "card-tag")
        tag.set_size_request(round(96 * u), -1)
        tag.set_yalign(0.5)
        tag.set_valign(Gtk.Align.CENTER)
        text.set_valign(Gtk.Align.CENTER)
        inner.pack_end(tag, False, False, 0)
        if c["eligible"] and not extra:
            w = Gtk.Button()
            w.set_relief(Gtk.ReliefStyle.NONE)
            w.add(inner)
            if c["selected"]:
                w.get_style_context().add_class("selected")
            w.connect("clicked", lambda _b, n=c["name"]: self.on_select(n))
            self.remember("card:" + c["name"], w)
        else:
            w = Gtk.Box()
            w.pack_start(inner, True, True, 0)
            if extra:
                w.get_style_context().add_class("selected")
        w.get_style_context().add_class("card")
        w.set_margin_bottom(round(10 * u))
        return w

    def note(self, title, lines, err=False):
        box = self.Gtk.Box(orientation=self.Gtk.Orientation.VERTICAL, spacing=round(4 * self.u))
        ctx = box.get_style_context()
        ctx.add_class("note")
        if err:
            ctx.add_class("note-err")
        box.pack_start(self.label(title, "note-title", wrap=True), False, False, 0)
        for line in lines:
            box.pack_start(self.label(line, "note-body", wrap=True), False, False, 0)
        box.set_margin_bottom(round(10 * self.u))
        return box

    def button(self, text, cls, handler, key, enabled=True):
        b = self.Gtk.Button(label=text)
        b.set_relief(self.Gtk.ReliefStyle.NONE)
        b.get_style_context().add_class(cls)
        b.set_sensitive(enabled)
        b.connect("clicked", lambda _b: handler())
        return self.remember(key, b)

    def power_button(self, view, cls="link"):
        from strings import T
        b = self.button(T["powerAsk"] if view["armed"] else T["poweroff"], cls, lambda: None, "power", enabled=view["screen"] != "progress")
        b.connect("clicked", lambda _b: self.on_power(b))
        b.connect("focus-out-event", lambda _b, _e: self.on_power_blur(b) or False)
        return b

    def alert(self, view):
        return [self.label(view["message"], "alert", wrap=True)] if view["message"] else []

    # -- screens -------------------------------------------------------------------------------------------------------------
    def screen_pick(self, view):
        from strings import T
        sel = next((c for c in view["cards"] if c["selected"]), None)
        cards = [self.card(c) for c in view["cards"]]
        cap = self.label(f"{T['detail']}  {sel['path']}" + (f" · {sel['model']}" if sel["model"] else "") if sel else T["pickNote"], "caption")
        cap.set_margin_top(round(4 * self.u))
        go = self.button(T["review"], "btn", self.on_review, "review", enabled=bool(sel))
        self.frame(T["pickTitle"], T["pickSubSelected"] if sel else T["pickSub"], cards + [cap] + self.alert(view),
                   [self.power_button(view), go])

    def screen_none(self, view):
        from strings import T
        cards = [self.card(c) for c in view["cards"]]
        box = self.note(T["noneBox"], [T["noneBody"]], err=True)
        refresh = self.button(T["refresh"], "btn", self.on_refresh, "refresh")
        self.frame(T["noneTitle"], T["noneSub"], cards + [box] + self.alert(view), [self.power_button(view), refresh])

    def screen_review(self, view):
        from strings import T
        Gtk, u = self.Gtk, self.u
        c = next(x for x in view["cards"] if x["name"] == view["device"])
        card = self.card(c, extra=T["target"], detail=c["path"] if False else f"{self.size_text(c)} · NVMe · {c['path']}")
        note = self.note(T["plan"], [T["planBody1"], T["planBody2"]])
        entry = Gtk.Entry()
        entry.set_size_request(round(150 * u), -1)
        entry.set_halign(Gtk.Align.END)
        entry.set_valign(Gtk.Align.CENTER)
        entry.connect("populate-popup", lambda _w, menu: menu.destroy())
        self.remember("typed", entry)
        go = self.button(T["go"], "btn", lambda: self.on_start(entry.get_text()), "go", enabled=False)
        entry.connect("changed", lambda e: go.set_sensitive(self.c.typed_ok(e.get_text())))
        q = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=round(3 * u))
        q.pack_start(self.label(T["typePrompt"], "confirm-q"), False, False, 0)
        q.pack_start(self.label(f"{T['detail']}  {c['path']}", "caption"), False, False, 0)
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=round(14 * u))
        row.pack_start(q, True, True, 0)
        row.pack_end(entry, False, False, 0)
        row.set_margin_top(round(8 * u))
        back = self.button(T["back"], "link", self.on_back, "back")
        self.frame(T["reviewTitle"], T["reviewSub"], [card, note, row] + self.alert(view), [back, go])
        self.pending_entry = entry

    def size_text(self, c):
        return f"{c['size'] / 2 ** 30:.1f} GiB"

    def screen_progress(self, view):
        from strings import T
        Gtk, u = self.Gtk, self.u
        st = view["state"]
        c = next((x for x in view["cards"] if x["name"] == st.get("device")), None) or {
            "name": st.get("device") or "", "title": T["internal"], "sub": "", "eligible": True, "selected": False, "tag": "", "path": "", "model": "", "size": 0}
        widgets = [self.card(c, extra=T["dest"], detail=f"{self.size_text(c)} · NVMe")]
        for i in range(3):
            status = "done" if st.get("step", 1) > i + 1 else "active" if st.get("step", 1) == i + 1 else "wait"
            pct = round((st.get("fraction") or 0) * 100)
            row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=round(14 * u))
            row.get_style_context().add_class("stepline-active" if status == "active" else "stepline")
            row.set_margin_top(round(18 * u))
            row.set_margin_bottom(round(8 * u))
            row.pack_start(self.label(f"{i + 1} {T['steps'][i]}", "stepline-active" if status == "active" else "stepline"), False, False, 0)
            row.pack_start(self.label(T["sDone"] if status == "done" else T["sActive"] if status == "active" else T["sWait"],
                                      "stepline-active" if status == "active" else "stepline"), False, False, 0)
            widgets.append(row)
            if status == "active":
                bar = Gtk.ProgressBar()
                bar.set_fraction(pct / 100)
                widgets.append(bar)
                widgets.append(self.label(f"{pct}%", "pct"))
        self.frame(T["busyTitle"], T["busySub"], widgets, [self.power_button(view), None])

    def screen_done(self, view):
        from strings import T
        st = view["state"]
        c = next((x for x in view["cards"] if x["name"] == st.get("device")), None)
        detail = (f"{self.size_text(c)} · NVMe · " if c else "") + f"{st.get('partitions')} {T['parts']}"
        card = self.card(c or {"title": T["internal"], "sub": "", "eligible": True, "selected": True, "tag": "", "name": ""}, extra=T["verified"], detail=detail)
        note = self.note(T["rebootTitle"], [T["rebootBody"]])
        reboot = self.button(T["reboot"], "btn", self.on_reboot, "reboot")
        self.frame(T["doneTitle"], T["doneSub"], [card, note] + self.alert(view), [None, reboot])

    def screen_failed(self, view):
        from strings import T
        st = view["state"]
        err = st.get("error") or {}
        wrote = st.get("written") == "started"
        again = None if wrote else self.button(T["again"], "link", self.on_dismiss, "again")
        box = self.note(err.get("ja", ""), [f"{T['detailLabel']}: {err.get('code', '')}"], err=True)
        where = self.note(T["written"] if wrote else T["notWritten"], [])
        self.frame(T["failTitle"], f"{T['failedStep']}: {err.get('step', 1)} {err.get('stepJa', '')}", [box, where] + self.alert(view),
                   [again, self.power_button(view, "btn")])

    # -- events (forward to the controller, then redraw) ---------------------------------------------------------------------
    def on_select(self, name):
        self.c.select(name)
        self.render(force=True)
        w = self.widgets.get("card:" + name)
        if w:
            w.grab_focus()

    def on_review(self):
        self.c.review()
        self.render(force=True)
        if "typed" in self.widgets:
            self.widgets["typed"].grab_focus()

    def on_back(self):
        self.c.back()
        self.render(force=True)

    def on_start(self, typed):
        self.c.start(typed)
        self.render(force=True)

    def on_refresh(self):
        self.c.refresh()
        self.render(force=True)

    def on_dismiss(self):
        self.c.dismiss()
        self.render(force=True)

    def on_reboot(self):
        if self.c.reboot() == "refused":
            from strings import T
            self.c.message = T["rebootBusy"]
        self.render(force=True)

    def on_power(self, button):
        from strings import T
        res = self.c.power_press()
        button.get_child().set_text(T["powerAsk"] if res == "armed" else T["poweroff"])

    def on_power_blur(self, button):
        from strings import T
        if getattr(self, "rebuilding", False):
            return
        self.c.power_blur()
        child = button.get_child()
        if child:
            child.set_text(T["poweroff"])

    def poll(self):
        """Called every 700 ms: adopt the true install state and redraw if anything changed."""
        self.c.sync()
        self.render()
        return True


def main(argv=None):
    import argparse
    sys.path.insert(0, HERE)
    import core
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", default=core.DEFAULT_WORK)
    ap.add_argument("--media-dir", default=core.DEFAULT_MEDIA)
    a = ap.parse_args(argv)
    use_bundled_fonts(a.work_dir)
    os.environ.setdefault("GDK_BACKEND", "x11")
    os.environ.setdefault("NO_AT_BRIDGE", "1")
    from controller import Controller
    import keys
    c = Controller(core.Host(), a.work_dir, a.media_dir)
    c.refresh()
    c.sync()
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk, GLib, Gtk
    screen = Gdk.Screen.get_default()
    width, height = screen.get_width(), screen.get_height()
    ui = InstallerUI(c, width, height)
    win = Gtk.Window()
    win.set_decorated(False)
    win.set_default_size(width, height)
    win.move(0, 0)
    win.set_resizable(False)
    win.add(ui.root)

    def on_key(_w, event):
        if keys.swallow(Gdk.keyval_name(event.keyval), int(event.state)):
            return True
        ensure_toplevel_focus(win)  # focus can be lost to key mashing or a lost X focus; the first Tab must still count
        return False
    win.connect("key-press-event", on_key)
    win.connect("key-release-event", lambda _w, e: keys.swallow(Gdk.keyval_name(e.keyval), int(e.state)))
    win.connect("destroy", lambda _w: Gtk.main_quit())
    win.connect("focus-out-event", lambda _w, _e: GLib.idle_add(ensure_toplevel_focus, win) and False)
    ui.render(force=True)
    win.show_all()
    win.fullscreen()
    ui.render(force=True)
    win.present()
    ensure_toplevel_focus(win)
    GLib.timeout_add(700, ui.poll)
    Gtk.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
