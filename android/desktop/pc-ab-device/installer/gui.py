#!/usr/bin/env python3
"""GTK 3 front end of the Awai OS PC installer (one process, no listener, no browser, no window manager needed).

  gui.py [--work-dir DIR] [--media-dir DIR]

It renders controller.Controller.view() and forwards events. The install itself runs in the detached core.py worker, so
closing or killing this process never stops a write; start.sh starts it again and it shows the true state.
Proportions follow design/installer-rev2.png (the revised Figma board): one unit u = min(W/1280, H/720) (compact layout: W/800, H/600) for the monitor that is really there
(the primary monitor's geometry, never the virtual screen), then reduced until the measured natural height fits. Everything sits
inside a safe area (3% on every side: TVs and portable monitors overscan); backgrounds still reach the edges.
"""
import json
import os
import sys
import time

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


REF = (1280, 720)  # the Figma board's wide screens
REF_COMPACT = (800, 600)  # and its compact ones (width < 1000 or portrait)
SAFE = 0.03  # share of each side kept free: TVs and portable monitors overscan, and nothing may sit under the bezel
CARD_GAP = 16


def is_compact(width, height):
    return width < 1000 or height > width


def css_for(u, sx=0, sy=0, compact=False):
    """Gtk CSS for one design unit u (pixels per Figma pixel). Colours, sizes and states are the revised Figma design's
    (rev2): 5px amber focus ring on a filled control, 2px blue selection, 18px cards. sx / sy are the safe margins."""
    p = lambda n: f"{max(1, round(n * u))}px"
    k = 0.82 if compact else 1.0
    ring = f"inset 0 0 0 {max(3, round(5 * u))}px #f0a000"
    card_h = 72 if compact else 92
    return f"""
* {{ font-family: "Noto Sans JP"; color: #1b2433; }}
window, .app {{ background: #ffffff; }}
.rail {{ background: #f2f4f8; padding: {max(sy, round(58 * u))}px {p(16)} {max(sy, round(40 * u))}px {max(sx, round(56 * u))}px; }}
.topbar {{ background: #f2f4f8; padding: {sy}px {max(sx, round(28 * u))}px 0 {max(sx, round(28 * u))}px; min-height: {max(round(36 * u), round(64 * u) - sy)}px; }}
.logo {{ border-radius: {p(8)}; }}
.release {{ font-size: {p(20)}; font-weight: 500; }}
.product {{ font-size: {p(36)}; font-weight: 500; }}
.brief {{ font-size: {p(15)}; font-weight: 500; }}
.step {{ font-size: {p(13 if compact else 18)}; color: #5b6678; }}
.step-current, .step-current label {{ color: #1d4fa3; font-weight: 700; }}
.dot {{ background: #d9dee7; border-radius: 999px; min-width: {p(10 if compact else 14)}; min-height: {p(10 if compact else 14)}; }}
.dot-on {{ background: #1d4fa3; }}
.title {{ font-size: {p(26 if compact else 40)}; font-weight: 500; }}
.sub {{ font-size: {p(15 if compact else 20)}; color: #5b6678; }}
.caption {{ font-size: {p(14)}; color: #5b6678; }}
.footrule {{ background: #d9dee7; min-height: 1px; }}
.hint {{ font-size: {p(14 if compact else 17)}; font-weight: 500; color: #1d4fa3; }}
button, button:focus {{ outline: none; }}
button {{ background-image: none; box-shadow: none; text-shadow: none; border-radius: 0; border: 0; background: transparent; padding: 0; margin: 0; }}
button.card {{ background: #ffffff; border-radius: {p(18)}; padding: {p(10)} {p(26)}; min-height: {p(card_h - 20)}; box-shadow: inset 0 0 0 1px #d9dee7; }}
button.card.selected {{ background: #e3ebfd; box-shadow: inset 0 0 0 2px #1d4fa3; }}
button.card:hover {{ background: #eef3ff; }}
button.card.selected:hover {{ background: #d6e2fb; }}
button.card:focus, button.card.selected:focus {{ box-shadow: {ring}; }}
box.card {{ background: #f1f3f6; border-radius: {p(18)}; padding: {p(10)} {p(26)}; min-height: {p(card_h - 20)}; box-shadow: inset 0 0 0 1px #d9dee7; }}
box.card.selected {{ background: #e3ebfd; box-shadow: inset 0 0 0 2px #1d4fa3; }}
.card-title {{ font-size: {p(24 * k)}; font-weight: 500; }}
.card-off .card-title, .card-off .card-tag {{ color: #5b6678; }}
.card-sub {{ font-size: {p(16 * k)}; color: #5b6678; }}
.card-tag {{ font-size: {p(16 * k)}; }}
.selected .card-tag {{ color: #1d4fa3; }}
.note {{ background: #f1f3f6; border-radius: {p(18)}; padding: {p(22)} {p(26)}; }}
.note-err {{ background: #fde3e1; }}
.note-title {{ font-size: {p(20)}; font-weight: 500; }}
.note-err .note-title {{ color: #8a1f17; }}
.note-body {{ font-size: {p(16)}; color: #5b6678; }}
.note-err .note-body {{ color: #8a1f17; }}
.alert {{ font-size: {p(15)}; color: #8a1f17; }}
button.btn {{ background: #1d4fa3; border-radius: 999px; padding: {p(14)} {p(32)}; min-height: {p(18 * 1.4)}; }}
button.btn label, button.second label, button.link label {{ font-size: {p(15 if compact else 18)}; font-weight: 700; }}
button.btn label {{ color: #ffffff; }}
button.btn:hover {{ background: #2a62c4; }}
button.btn:active {{ background: #123a80; }}
button.btn:focus {{ background: #123a80; box-shadow: {ring}; }}
button.btn:disabled {{ background: #d9dee7; box-shadow: none; }}
button.btn:disabled label {{ color: #5b6678; }}
button.second {{ background: #f1f3f6; border-radius: 999px; padding: {p(14)} {p(32)}; min-height: {p(18 * 1.4)}; }}
button.second label {{ color: #1d4fa3; }}
button.second:hover {{ background: #e3ebfd; }}
button.second:focus {{ background: #e3ebfd; box-shadow: {ring}; }}
button.link {{ border-radius: 999px; padding: {p(14)} {p(32)}; min-height: {p(18 * 1.4)}; }}
button.link label {{ color: #1d4fa3; }}
button.link:hover {{ background: #e8eefb; }}
button.link:focus {{ background: #e3ebfd; box-shadow: {ring}; }}
button.link:disabled {{ background: #d9dee7; }}
button.link:disabled label {{ color: #5b6678; }}
.veil {{ background: rgba(27, 36, 51, 0.45); }}
.dialog {{ background: #ffffff; border-radius: {p(24)}; padding: {p(40)} {p(44)} {p(28)} {p(44)}; }}
.dialog-title {{ font-size: {p(30)}; font-weight: 500; }}
.dialog-fact {{ font-size: {p(20)}; color: #5b6678; }}
.dialog-sub {{ font-size: {p(16)}; color: #5b6678; }}
.dialog-hint {{ font-size: {p(16)}; font-weight: 500; color: #1d4fa3; }}
scrolledwindow {{ background: transparent; border: 0; }}
scrollbar {{ background: transparent; border: 0; }}
scrollbar trough {{ background: #eef1f6; border: 0; min-width: {p(9)}; min-height: {p(9)}; }}
scrollbar slider {{ background: #9aa6ba; border: 0; border-radius: {p(5)}; min-width: {p(9)}; min-height: {p(30)}; }}
.stepline {{ font-size: {p(18)}; color: #5b6678; }}
.stepline-active, .stepline-active label {{ font-size: {p(22)}; font-weight: 700; color: #1d4fa3; }}
progressbar trough {{ background: #d9dee7; border: 0; border-radius: {p(6)}; min-height: {p(12)}; }}
progressbar progress {{ background: #1d4fa3; border: 0; border-radius: {p(6)}; min-height: {p(12)}; }}
"""


def monitor_geometry(display=None, log=None):
    """(x, y, w, h) of the monitor the installer must use, in logical pixels: the primary monitor, else the first one.
    Never the virtual screen: with several outputs that is larger than any single monitor and cuts the window off.
    `log`, if given, receives one line per monitor (diagnosis only)."""
    import gi
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk
    display = display or Gdk.Display.get_default()
    primary = display.get_primary_monitor()
    chosen = primary or (display.get_monitor(0) if display.get_n_monitors() else None)
    for i in range(display.get_n_monitors()):
        m = display.get_monitor(i)
        g = m.get_geometry()
        if log:
            log(f"monitor {i}: {m.get_model() or '?'} {g.width}x{g.height}+{g.x}+{g.y} scale={m.get_scale_factor()} "
                f"{'primary ' if m is primary else ''}{'USED' if m is chosen else ''}")
    if chosen is None:
        screen = display.get_default_screen()
        return 0, 0, screen.get_width(), screen.get_height()
    g = chosen.get_geometry()
    return g.x, g.y, g.width, g.height


class InstallerUI:
    """The widget tree. `root` goes into a Gtk.Window (gui.main) or a Gtk.OffscreenWindow (tests, screenshots).
    (width, height) is the monitor's size; safe is the share kept free on every side."""

    def __init__(self, controller, width, height, safe=SAFE):
        import gi
        gi.require_version("Gtk", "3.0")
        gi.require_version("Gdk", "3.0")
        from gi.repository import Gdk, GdkPixbuf, GLib, Gtk, Pango
        self.Gtk, self.Gdk, self.GLib, self.Pango, self.GdkPixbuf = Gtk, Gdk, GLib, Pango, GdkPixbuf
        self.c = controller
        self.safe = safe
        self.widgets = {}
        self.last_key = None
        self.shown_confirming = False
        settings = Gtk.Settings.get_default()
        for name, value in (("gtk-enable-mnemonics", False), ("gtk-enable-accels", False), ("gtk-menu-bar-accel", ""),
                            ("gtk-xft-dpi", 96 * 1024), ("gtk-cursor-blink", False), ("gtk-enable-animations", False),
                            ("gtk-overlay-scrolling", False)):
            try:
                settings.set_property(name, value)
            except Exception:
                pass
        self.provider = Gtk.CssProvider()
        Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), self.provider, Gtk.STYLE_PROVIDER_PRIORITY_USER)
        self.root = Gtk.Overlay()
        self.base = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.base.get_style_context().add_class("app")
        self.root.add(self.base)
        V, H = Gtk.Orientation.VERTICAL, Gtk.Orientation.HORIZONTAL
        # compact layout (narrow or portrait): a stepper bar on top instead of the left rail
        self.topbar = Gtk.Box(orientation=H)
        self.topbar.get_style_context().add_class("topbar")
        self.topbar.set_no_show_all(True)  # shown or hidden by build(): a window-wide show_all must not undo the choice
        self.base.pack_start(self.topbar, False, False, 0)
        self.row = Gtk.Box(orientation=H)
        self.base.pack_start(self.row, True, True, 0)
        self.rail = Gtk.Box(orientation=V)
        self.rail.get_style_context().add_class("rail")
        self.rail.set_no_show_all(True)
        self.main = Gtk.Box(orientation=V)
        self.row.pack_start(self.rail, False, False, 0)
        self.row.pack_start(self.main, True, True, 0)
        self.logo = Gtk.Image()
        self.logo.set_halign(Gtk.Align.START)
        self.logo.get_style_context().add_class("logo")
        self.logo_small = Gtk.Image()
        self.logo_small.get_style_context().add_class("logo")
        self.steps_box = Gtk.Box(orientation=V)
        self.steps_bar = Gtk.Box(orientation=H)
        self.title = self.label("", "title")
        self.sub = self.label("", "sub")
        self.hint = self.label("", "hint")
        self.body = Gtk.Box(orientation=V)
        self.scroller = Gtk.ScrolledWindow()
        self.scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        self.scroller.set_shadow_type(Gtk.ShadowType.NONE)
        self.scroller.set_overlay_scrolling(False)
        self.scroller.add(self.body)
        self.scroller.set_can_focus(False)  # focus belongs to the cards and buttons, never to the scroll area itself
        self.scroller.get_child().set_can_focus(False)
        self.body.set_focus_vadjustment(self.scroller.get_vadjustment())  # Tab through the cards scrolls the focused one into view
        self.actions = Gtk.Box(orientation=H)
        self.rule = Gtk.Box()
        self.rule.get_style_context().add_class("footrule")
        self.build_rail()
        for w, expand in ((self.title, False), (self.sub, False), (self.scroller, True), (self.hint, False), (self.rule, False), (self.actions, False)):
            self.main.pack_start(w, expand, expand, 0)
        self.want_focus = None
        self.screen_since = 0.0
        self.grace = 1.2  # seconds after a done / failed screen appears by itself in which its buttons ignore a key held down from before
        self.nav_v, self.nav_h = [], []
        # the one confirmation: a veil over the same window, never a second window
        self.veil = Gtk.EventBox()
        self.veil.set_visible_window(True)
        self.veil.get_style_context().add_class("veil")
        self.veil.set_no_show_all(True)
        self.dialog = Gtk.Box(orientation=V)
        self.dialog.get_style_context().add_class("dialog")
        self.dialog.set_halign(Gtk.Align.CENTER)
        self.dialog.set_valign(Gtk.Align.CENTER)
        self.veil.add(self.dialog)
        self.root.add_overlay(self.veil)
        self.root.set_overlay_pass_through(self.veil, False)
        self.u = 1.0
        self.set_geometry(width, height, render=False)

    # -- geometry ------------------------------------------------------------------------------------------------------------
    def set_geometry(self, width, height, render=True):
        """The monitor's size changed (or is known for the first time): everything is recomputed from it."""
        self.W, self.H = width, height
        self.sx, self.sy = round(self.safe * width), round(self.safe * height)
        self.compact = is_compact(width, height)
        ref = REF_COMPACT if self.compact else REF
        self.u_max = min(width / ref[0], height / ref[1])
        self.u = self.u_max
        self.root.set_size_request(width, height)
        self.rail.set_size_request(round(0.305 * width), -1)
        self.apply_unit(self.u_max)
        if render:
            self.render(force=True)

    def apply_unit(self, u):
        """Everything that depends on the design unit: CSS, margins, the logo."""
        self.u = u
        self.provider.load_from_data(css_for(u, self.sx, self.sy, self.compact).encode())
        self.pad = max(8, round(6 * u))  # room for the focus ring inside the scrolled list
        left = round((32 if self.compact else 0.0516 * 1280) * u) if self.compact else max(0, round(0.356 * self.W) - round(0.305 * self.W))
        if self.compact:
            side = max(self.sx, round(32 * u))
            self.main.set_margin_start(max(self.sx, side - self.pad))
            self.main.set_margin_end(side)
            self.main.set_margin_top(round(32 * u))
            self.main.set_margin_bottom(max(self.sy, round(23 * u)))
            self.dialog_pad = side
        else:
            self.main.set_margin_start(max(0, left - self.pad))
            self.main.set_margin_end(max(self.sx, self.W - round(0.97 * self.W)))
            self.main.set_margin_top(max(self.sy, round(66 * u)))
            self.main.set_margin_bottom(max(self.sy, round(39 * u)))
        self.body.set_margin_start(self.pad)
        self.body.set_margin_end(self.pad)
        self.body.set_margin_top(self.pad)
        self.title.set_margin_start(self.pad)
        self.sub.set_margin_start(self.pad)
        self.hint.set_margin_start(self.pad)
        self.sub.set_margin_top(round(8 * u))
        self.sub.set_margin_bottom(round(14 * u))
        self.hint.set_margin_top(round(6 * u))
        self.rule.set_margin_top(round(8 * u))
        self.rule.set_margin_bottom(round(12 * u))
        self.actions.set_margin_start(self.pad)
        size = max(8, round(60 * u))
        pix = self.GdkPixbuf.Pixbuf.new_from_file_at_scale(os.path.join(HERE, "assets", "logo.png"), size, size, True)
        self.logo.set_from_pixbuf(pix)
        small = max(8, round(36 * u))
        self.logo_small.set_from_pixbuf(self.GdkPixbuf.Pixbuf.new_from_file_at_scale(os.path.join(HERE, "assets", "logo.png"), small, small, True))
        self.rel.set_margin_top(round(22 * u))
        self.line_height(self.prod, round(48 * u * 1024))  # the design's pitch: 48 for the 36px font
        self.prod.set_margin_top(round(26 * u))
        self.steps_box.set_margin_top(round(40 * u))
        self.steps_box.set_spacing(round(20 * u))
        self.steps_bar.set_margin_start(round(24 * u))
        self.logo_small.set_margin_end(round(12 * u))
        self.rail.queue_resize()
        self.main.queue_resize()

    # -- helpers -------------------------------------------------------------------------------------------------------------
    def label(self, text, cls, wrap=True, xalign=0.0):
        """Every label wraps (never clips or runs past its box); words first, single characters when a word is wider than the line."""
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
        self.rail.pack_start(self.logo, False, False, 0)
        self.rel = self.label(T["release"], "release")
        self.rail.pack_start(self.rel, False, False, 0)
        self.prod = self.label(T["product"] + "\n" + T["product2"], "product")
        self.rail.pack_start(self.prod, False, False, 0)
        self.rail.pack_start(self.steps_box, False, False, 0)
        self.topbar.pack_start(self.logo_small, False, False, 0)
        brief = self.label(T["releaseShort"], "brief")
        brief.set_valign(self.Gtk.Align.CENTER)
        brief.set_yalign(0.5)
        self.topbar.pack_start(brief, False, False, 0)
        self.topbar.pack_start(self.steps_bar, True, True, 0)
        for w in (self.logo_small, self.steps_bar):
            w.set_valign(self.Gtk.Align.CENTER)

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
        widget.connect("focus-in-event", lambda _w, _e: self.update_hint() or False)
        return widget

    # -- rendering -----------------------------------------------------------------------------------------------------------
    def default_focus(self, view=None):
        """The sensible control of the screen that just opened: the selected SSD's next step, else the first SSD; never power."""
        view = view or self.c.view()
        w = self.widgets
        order = {"pick": ("review" if view["selected"] else None, "card:first"), "none": ("refresh",), "review": ("go",),
                 "done": ("reboot",), "failed": ("again", "power"), "progress": ()}[view["screen"]]
        for key in order:
            if key == "card:first":
                key = next((k for k in self.nav_v if k.startswith("card:")), None)
            if key in w and w[key].get_sensitive():
                return key
        return None

    def focus_key(self, key):
        """Put the focus on the control `key` (None: nothing is focused)."""
        top = self.root.get_toplevel()
        if key in self.widgets:
            self.widgets[key].grab_focus()
        elif hasattr(top, "set_focus"):
            top.set_focus(None)

    def render(self, force=False):
        """Rebuild from the controller's view at the largest unit that fits; keep focus on the same logical widget."""
        view = self.c.view()
        key = json.dumps({k: v for k, v in view.items() if k not in ("state", "armed")}, sort_keys=True, default=str) + json.dumps(
            {k: v for k, v in view["state"].items() if k != "updatedAt"}, sort_keys=True, default=str)
        if key == self.last_key and not force:
            return
        self.last_key = key
        top = self.root.get_toplevel()
        focused = top.get_focus() if top is not None and hasattr(top, "get_focus") else None
        before = getattr(focused, "awai_key", None)
        screen_changed = getattr(self, "shown_screen", None) != view["screen"]
        if screen_changed:
            self.screen_since = time.monotonic()
        self.shown_screen = view["screen"]
        self.rebuilding = True  # widgets losing focus because they are destroyed is not the user leaving a button
        self.fit(view)
        want, self.want_focus = self.want_focus, None
        confirming = view["confirming"]
        if confirming:
            target = want if want in self.widgets else before if self.shown_confirming and before in self.widgets else "askCancel"
        elif self.shown_confirming:
            target = "go"
        elif want in self.widgets:
            target = want
        elif screen_changed or before not in self.widgets:
            target = self.default_focus(view)
        else:
            target = before
        self.focus_key(target)
        self.update_hint()
        self.shown_confirming = confirming
        self.rebuilding = False

    def build(self, view):
        self.widgets = {}
        for box in (self.body, self.actions):
            self.clear(box)
        getattr(self, "screen_" + view["screen"])(view)
        self.render_rail(view["rail"])
        self.build_dialog(view)
        self.root.show_all()
        for box, on in ((self.topbar, self.compact), (self.rail, not self.compact)):  # stepper bar when narrow or portrait, else the rail
            if on:
                box.show()
                for child in box.get_children():
                    child.show_all()
            else:
                box.hide()

    def measure(self, view):
        """(natural height of the window content, height the confirmation needs). The list keeps two cards at least and scrolls;
        every other screen asks for its whole body. The power button is measured with its longer (armed) text."""
        u = self.u
        inner = max(50, self.scroller.get_allocated_width() - 2 * self.pad if self.scroller.get_allocated_width() > 1 else self.body_width() - 2 * self.pad)
        nat = self.body.get_preferred_height_for_width(self.body_width() - 2 * self.pad - round(12 * u))[1] + self.pad
        listy = view["screen"] in ("pick", "none")
        card_h = 72 if self.compact else 92
        self.scroller.set_min_content_height(min(nat, round(2 * (card_h + CARD_GAP) * u)) if listy else nat)
        power = self.widgets.get("power")
        label = power.get_child() if power is not None else None
        if label is not None:
            from strings import T
            shown = label.get_text()
            label.set_text(T["powerAsk"])
        shown_hint = self.hint.get_text()
        self.hint.set_text(self.hint_text(longest=True))
        total = self.base.get_preferred_height_for_width(self.W)[0]
        self.hint.set_text(shown_hint)
        if label is not None:
            label.set_text(shown)
        dlg = 0
        if view["confirming"]:
            dlg = self.dialog.get_preferred_height_for_width(self.dialog_w)[1] + 2 * self.sy
        return total, dlg

    def body_width(self):
        """Width of the list area: from the card column's left edge to the right safe margin."""
        if self.compact:
            return self.W - 2 * max(self.sx, round(32 * self.u)) + 2 * self.pad
        return round(0.97 * self.W) - round(0.356 * self.W) + 2 * self.pad

    def fit(self, view):
        """Largest unit u <= u_max for which the measured natural height fits the monitor (and the confirmation fits too)."""
        u = self.u_max
        floor = 0.5 * self.u_max
        for _ in range(30):
            self.dialog_w = min(round(720 * u), self.W - 2 * self.sx)
            self.apply_unit(u)
            self.build(view)
            total, dlg = self.measure(view)
            need = max(total, dlg)
            if need <= self.H or u <= floor:
                break
            u = max(floor, u * min(0.97, self.H / need))
        self.fitted = (u, total, dlg)

    def on_tab(self, backward=False):
        """Tab / Shift+Tab: ordinary GTK traversal over the controls (the action row has the primary action first)."""
        top = self.root.get_toplevel()
        direction = self.Gtk.DirectionType.TAB_BACKWARD if backward else self.Gtk.DirectionType.TAB_FORWARD
        return top.child_focus(direction)

    def reset_focus(self):
        """Focus the sensible control of the current screen."""
        self.focus_key(self.default_focus())
        self.update_hint()

    def current_key(self):
        top = self.root.get_toplevel()
        return getattr(top.get_focus(), "awai_key", None) if top is not None and hasattr(top, "get_focus") else None

    def on_arrow(self, name):
        """↑ ↓ walk the SSD cards and then the buttons (wrapping); ← → walk the buttons of the row. Disabled and unselectable ones are
        skipped. Returns whether the key was used."""
        usable = lambda k: k in self.widgets and self.widgets[k].get_sensitive()
        cur = self.current_key()
        if name in ("Up", "Down"):
            seq = [k for k in self.nav_v if usable(k)]
            step = 1 if name == "Down" else -1
        else:
            seq = [k for k in self.nav_h if usable(k)]
            step = 1 if name == "Right" else -1
            if cur not in seq:
                return bool(seq) and cur is not None and not cur.startswith("card:")
        if not seq:
            return True
        if cur in seq:
            target = seq[(seq.index(cur) + step) % len(seq)] if name in ("Up", "Down") else seq[min(len(seq) - 1, max(0, seq.index(cur) + step))]
        else:
            target = seq[0] if step > 0 else seq[-1]
        if target.startswith("card:") and not (cur or "card:").startswith("card:") and self.c.selected and usable("card:" + self.c.selected):
            target = "card:" + self.c.selected  # coming back up from the buttons lands on the chosen SSD
        self.focus_key(target)
        self.update_hint()
        return True

    def on_escape(self):
        """Esc: cancel in the confirmation, back on the review, start over on a failure that wrote nothing; nothing elsewhere."""
        if self.c.confirming:
            self.on_cancel()
            return True
        if self.c.screen == "review":
            self.on_back()
            return True
        if self.c.screen == "failed" and "again" in self.widgets and self.widgets["again"].get_sensitive():
            self.on_dismiss()
            return True
        return False

    def update_hint(self):
        """The line above the buttons: what Enter does on the focused control right now, and the other keys that work here."""
        self.hint.set_text(self.hint_text())

    def hint_text(self, longest=False):
        from strings import T
        gap = "　　"
        if self.c.confirming:
            return T["hintAsk"]
        screen = self.c.screen
        if screen == "progress":
            return T["busyHint"]
        do = self.enter_action(longest)
        parts = [T["hintDo"].format(action=do)] if do else []
        if screen in ("pick", "none"):
            parts += [T["hintKeys"], T["hintMouse"]] if screen == "pick" else []
        elif screen == "review":
            parts.append(T["hintEsc"].format(action=T["back"]))
        return gap.join(parts)

    def enter_action(self, longest=False):
        from strings import T
        if longest:
            return T["powerAsk"]
        key = self.current_key()
        w = self.widgets.get(key) if key else None
        if w is None or not w.get_sensitive():
            return ""
        if key.startswith("card:"):
            return T["hintSelect"]
        return self.button_label(w)

    def button_label(self, w):
        child = w.get_child()
        return child.get_text() if isinstance(child, self.Gtk.Label) else ""

    def render_rail(self, active):
        from strings import T
        for box in (self.steps_box, self.steps_bar):
            self.clear(box)
        for i, name in enumerate(T["rail"]):
            on, done = i == active, i < active
            text = name + ("　✓" if done else "")
            for box, horizontal in ((self.steps_box, False), (self.steps_bar, True)):
                row = self.Gtk.Box(orientation=self.Gtk.Orientation.HORIZONTAL, spacing=round((8 if horizontal else 14) * self.u))
                dot = self.Gtk.Box()
                dot.set_valign(self.Gtk.Align.CENTER)
                dot.get_style_context().add_class("dot")
                if on or done:
                    dot.get_style_context().add_class("dot-on")
                lab = self.label(text, "step-current" if on else "step")
                lab.get_style_context().add_class("step")
                if horizontal:
                    lab.set_valign(self.Gtk.Align.CENTER)
                    lab.set_yalign(0.5)
                    row.set_valign(self.Gtk.Align.CENTER)
                row.pack_start(dot, False, False, 0)
                row.pack_start(lab, True, True, 0)
                box.pack_start(row, True, True, 0) if horizontal else box.pack_start(row, False, False, 0)

    def frame(self, title, sub, body, actions):
        """actions = [left, right] visually; the Tab order puts the primary (right) first, then the left one."""
        self.title.set_text(title)
        self.sub.set_text(sub)
        self.sub.set_visible(bool(sub))
        for w in body:
            self.body.pack_start(w, False, False, 0)
        left, right = actions
        if left is not None:
            self.actions.pack_start(left, False, False, 0)
        if right is not None:
            self.actions.pack_end(right, False, False, 0)
        chain = [w for w in (right, left) if w is not None]  # insensitive ones are skipped by GTK itself
        self.actions.set_focus_chain(chain)
        cards = [w.awai_key for w in body if getattr(w, "awai_key", "").startswith("card:")]
        self.nav_v = cards + [w.awai_key for w in chain]
        self.nav_h = [w.awai_key for w in (left, right) if w is not None]

    def card(self, c, tag=None, detail=None):
        """A selectable card (a whole-card button) when the SSD is eligible and no tag is forced; else a plain panel."""
        Gtk, u = self.Gtk, self.u
        sub = detail if detail is not None else c["sub"]
        inner = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=round(16 * u))
        text = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=round(6 * u))
        text.pack_start(self.label(c["title"], "card-title"), False, False, 0)
        if sub:
            text.pack_start(self.label(sub, "card-sub"), False, False, 0)
        inner.pack_start(text, True, True, 0)
        tagl = self.label(tag or c["tag"], "card-tag", xalign=1.0)
        tagl.set_yalign(0.5)
        tagl.set_valign(Gtk.Align.CENTER)
        text.set_valign(Gtk.Align.CENTER)
        inner.pack_end(tagl, False, False, 0)
        if c["eligible"] and not tag:
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
            if tag:
                w.get_style_context().add_class("selected")
            else:
                w.get_style_context().add_class("card-off")
        w.get_style_context().add_class("card")
        w.set_margin_bottom(round(CARD_GAP * u * (0.62 if self.compact else 1)))
        return w

    def note(self, title, lines, err=False):
        box = self.Gtk.Box(orientation=self.Gtk.Orientation.VERTICAL, spacing=round(6 * self.u))
        ctx = box.get_style_context()
        ctx.add_class("note")
        if err:
            ctx.add_class("note-err")
        box.pack_start(self.label(title, "note-title"), False, False, 0)
        for line in lines:
            box.pack_start(self.label(line, "note-body"), False, False, 0)
        box.set_margin_bottom(round(CARD_GAP * self.u))
        return box

    def button(self, text, cls, handler, key, enabled=True):
        b = self.Gtk.Button(label=text)
        b.set_relief(self.Gtk.ReliefStyle.NONE)
        b.get_style_context().add_class(cls)
        b.set_sensitive(enabled)
        child = b.get_child()
        child.set_line_wrap(True)
        child.set_line_wrap_mode(self.Pango.WrapMode.WORD_CHAR)
        child.set_justify(self.Gtk.Justification.CENTER)
        b.connect("clicked", lambda _b: handler())
        return self.remember(key, b)

    def power_button(self, view, cls="link"):
        from strings import T
        b = self.button(T["powerAsk"] if view["armed"] else T["poweroff"], cls, lambda: None, "power", enabled=view["screen"] != "progress")
        b.connect("clicked", lambda _b: self.on_power(b))
        b.connect("focus-out-event", lambda _b, _e: self.on_power_blur(b) or False)
        return b

    def alert(self, view):
        return [self.label(view["message"], "alert")] if view["message"] else []

    def size_text(self, c):
        return f"{c['size'] / 2 ** 30:.1f} GiB"

    # -- screens -------------------------------------------------------------------------------------------------------------
    def screen_pick(self, view):
        from strings import T
        sel = next((c for c in view["cards"] if c["selected"]), None)
        cards = [self.card(c) for c in view["cards"]]
        go = self.button(T["review"], "btn", self.on_review, "review", enabled=bool(sel))
        many = sum(1 for c in view["cards"] if c["eligible"]) > 1
        self.frame(T["pickTitle"], T["pickSubMany"] if many else T["pickSubOne"], cards + self.alert(view), [self.power_button(view), go])

    def screen_none(self, view):
        from strings import T
        cards = [self.card(c) for c in view["cards"]]
        box = self.note(T["noneBox"], [T["noneBody"]], err=True)
        refresh = self.button(T["refresh"], "btn", self.on_refresh, "refresh")
        self.frame(T["noneTitle"], T["noneSub"], cards + [box] + self.alert(view), [self.power_button(view), refresh])

    def screen_review(self, view):
        from strings import T
        c = next(x for x in view["cards"] if x["name"] == view["device"])
        card = self.card(c, tag=T["target"])
        note = self.note(T["plan"], [T["planBody1"], T["planBody2"], T["planBody3"]])
        cap = self.label(f"/dev/{c['name']}", "caption")  # the technical path: small, last
        go = self.button(T["go"], "btn", self.on_go, "go")
        back = self.button(T["back"], "second", self.on_back, "back")
        self.frame(T["reviewTitle"], T["reviewSub"], [card, note] + self.alert(view) + [cap], [back, go])

    def build_dialog(self, view):
        """The confirmation: what will happen to which SSD, and the two answers. The cancel button comes first in the Tab order and has the focus."""
        from strings import T
        Gtk, u = self.Gtk, self.u
        self.clear(self.dialog)
        if not view["confirming"]:
            self.veil.hide()
            self.base.set_sensitive(True)
            return
        c = next((x for x in view["cards"] if x["name"] == view["device"]), None)
        many = sum(1 for x in view["cards"] if x["eligible"]) > 1
        self.dialog.set_size_request(self.dialog_w, -1)
        for side, v in (("start", self.sx), ("end", self.sx), ("top", self.sy), ("bottom", self.sy)):
            getattr(self.dialog, f"set_margin_{side}")(v)
        self.dialog.pack_start(self.label(T["askTitle1"], "dialog-title"), False, False, 0)
        title = self.label(T["askTitle2"], "dialog-title")
        title.set_margin_bottom(round(16 * u))
        self.dialog.pack_start(title, False, False, 0)
        if c:
            self.dialog.pack_start(self.label(T["askFact"].format(size=self.size_text(c)), "dialog-fact"), False, False, 0)
            if c["who"] and many:
                self.dialog.pack_start(self.label(c["who"], "dialog-sub"), False, False, 0)
        warn = self.label(T["askPower"], "dialog-fact")
        warn.set_margin_top(round(6 * u))
        self.dialog.pack_start(warn, False, False, 0)
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=round(20 * u))
        row.set_margin_top(round(22 * u))
        row.set_halign(Gtk.Align.START)
        cancel = self.button(T["askCancel"], "second", self.on_cancel, "askCancel")
        go = self.button(T["askGo"], "btn", self.on_confirm, "askGo")
        row.pack_start(cancel, False, False, 0)
        row.pack_start(go, False, False, 0)
        row.set_focus_chain([cancel, go])
        self.dialog.pack_start(row, False, False, 0)
        hint = self.label(T["hintAsk"], "dialog-hint")
        hint.set_margin_top(round(22 * u))
        self.dialog.pack_start(hint, False, False, 0)
        self.dialog.set_focus_chain([row])
        self.nav_v = self.nav_h = ["askCancel", "askGo"]  # the arrows stay inside the confirmation
        self.dialog.show_all()
        self.veil.show()
        self.base.set_sensitive(False)

    def screen_progress(self, view):
        from strings import T
        Gtk, u = self.Gtk, self.u
        st = view["state"]
        c = next((x for x in view["cards"] if x["name"] == st.get("device")), None) or {
            "name": st.get("device") or "", "title": T["internal"], "sub": "", "eligible": True, "selected": False, "tag": "", "path": "", "model": "", "size": 0}
        widgets = [self.card(c, tag=T["busyTag"], detail=self.size_text(c) if c["size"] else "")]
        step, pct = st.get("step", 1), round((st.get("fraction") or 0) * 100)
        for i in range(3):
            status = "done" if step > i + 1 else "active" if step == i + 1 else "wait"
            text = T[f"step{i + 1}"] + (f"　{T['sDone']}" if status == "done" else f"　{T['pct'].format(pct=pct)}" if status == "active" else f"　{T['sWait']}")
            row = self.label(text, "stepline-active" if status == "active" else "stepline")
            row.set_margin_top(round(10 * u))
            row.set_margin_bottom(round(8 * u))
            widgets.append(row)
            if status == "active":
                bar = Gtk.ProgressBar()
                bar.set_fraction(pct / 100)
                widgets.append(bar)
        self.frame(T["busyTitle"], T["busySub"], widgets, [self.power_button(view, "btn"), None])

    def screen_done(self, view):
        from strings import T
        st = view["state"]
        c = next((x for x in view["cards"] if x["name"] == st.get("device")), None)
        detail = f"{self.size_text(c)} {T['dot']} " if c else ""
        detail += T["parts"].format(n=st.get("partitions"))
        card = self.card(c or {"title": T["internal"], "sub": "", "eligible": True, "selected": True, "tag": "", "name": ""}, tag=T["verified"], detail=detail)
        note = self.note(T["rebootTitle"], [T["rebootBody"]])
        reboot = self.button(T["reboot"], "btn", self.on_reboot, "reboot")
        self.frame(T["doneTitle"], T["doneSub"], [card, note] + self.alert(view), [None, reboot])

    def screen_failed(self, view):
        from strings import T
        st = view["state"]
        err = st.get("error") or {}
        wrote = st.get("written") == "started"
        again = None if wrote else self.button(T["again"], "btn", self.on_dismiss, "again")
        box = self.note(err.get("ja", ""), [T["supportNo"].format(code=err.get("code", "")), T["failedStep"].format(step=f"{err.get('step', 1)} {err.get('stepJa', '')}".strip())], err=True)
        self.frame(T["failTitle"], T["failSubWritten"] if wrote else T["failSubNone"], [box] + self.alert(view),
                   [self.power_button(view, "btn" if wrote else "link"), again])

    # -- events (forward to the controller, then redraw) ---------------------------------------------------------------------
    def too_soon(self):
        """A done / failed screen that opened by itself ignores its buttons for a moment: a key held down from the screen before
        (someone mashing Enter) must not reboot, dismiss or power off."""
        return self.c.screen in ("done", "failed") and time.monotonic() - self.screen_since < self.grace

    def on_select(self, name):
        """Choose this SSD and move on to the review button. On the SSD that is already chosen, Enter / a second click goes on to the review."""
        if self.c.selected == name:
            self.on_review()
            return
        self.c.select(name)
        self.want_focus = "review"
        self.render(force=True)

    def on_review(self):
        self.c.review()
        self.render(force=True)

    def on_back(self):
        self.c.back()
        self.render(force=True)

    def on_go(self):
        self.c.ask()
        self.render(force=True)

    def on_cancel(self):
        self.c.cancel()
        self.render(force=True)

    def on_confirm(self):
        self.c.start(True)
        self.render(force=True)

    def on_refresh(self):
        self.c.refresh()
        self.render(force=True)

    def on_dismiss(self):
        if self.too_soon():
            return
        self.c.dismiss()
        self.render(force=True)

    def on_reboot(self):
        if self.too_soon():
            return
        if self.c.reboot() == "refused":
            from strings import T
            self.c.message = T["rebootBusy"]
        self.render(force=True)

    def on_power(self, button):
        from strings import T
        if self.too_soon():
            return
        res = self.c.power_press()
        button.get_child().set_text(T["powerAsk"] if res == "armed" else T["poweroff"])
        self.update_hint()

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


def log_line(work, text):
    try:
        with open(os.path.join(work, "display.txt"), "a") as f:
            f.write(text + "\n")
    except OSError:
        pass


def main(argv=None):
    import argparse
    sys.path.insert(0, HERE)
    import core
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", default=core.DEFAULT_WORK)
    ap.add_argument("--media-dir", default=core.DEFAULT_MEDIA)
    ap.add_argument("--safe", type=float, default=SAFE, help="share of every side kept free (overscan)")
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
    display = Gdk.Display.get_default()
    say = lambda t: log_line(a.work_dir, t)
    x, y, width, height = monitor_geometry(display, say)
    say(f"window {width}x{height}+{x}+{y} safe={a.safe}")
    ui = InstallerUI(c, width, height, a.safe)
    win = Gtk.Window()
    win.set_decorated(False)
    win.set_resizable(False)
    win.set_default_size(width, height)
    win.move(x, y)
    win.add(ui.root)

    def place():
        """No window manager: the window must put itself on the one monitor (never fullscreen(): without a WM GDK falls back to the
        whole virtual screen, which with several outputs is larger than any monitor)."""
        nx, ny, nw, nh = monitor_geometry(display)
        if (nw, nh) != (ui.W, ui.H):
            say(f"monitors changed: window {nw}x{nh}+{nx}+{ny}")
            ui.set_geometry(nw, nh)
        win.move(nx, ny)
        gw = win.get_window()
        if gw is not None:
            gw.move_resize(nx, ny, nw, nh)
        return False

    def on_key(_w, event):
        name = Gdk.keyval_name(event.keyval)
        if keys.swallow(name, int(event.state)):
            return True
        ensure_toplevel_focus(win)  # focus can be lost to key mashing or a lost X focus; the first Tab must still count
        if name in ("Tab", "ISO_Left_Tab"):
            ui.on_tab(backward=name == "ISO_Left_Tab" or bool(event.state & Gdk.ModifierType.SHIFT_MASK))
            return True
        if name in ("Up", "Down", "Left", "Right", "KP_Up", "KP_Down", "KP_Left", "KP_Right"):
            return ui.on_arrow(name.replace("KP_", ""))
        if name == "Escape":
            ui.on_escape()
            return True
        return False
    win.connect("key-press-event", on_key)
    win.connect("key-release-event", lambda _w, e: keys.swallow(Gdk.keyval_name(e.keyval), int(e.state)))
    win.connect("destroy", lambda _w: Gtk.main_quit())
    win.connect("focus-out-event", lambda _w, _e: GLib.idle_add(ensure_toplevel_focus, win) and False)
    for sig in ("monitors-changed", "size-changed"):
        display.get_default_screen().connect(sig, lambda *_a: GLib.idle_add(place))
    ui.render(force=True)
    win.show_all()
    place()
    ui.render(force=True)
    win.present()
    ensure_toplevel_focus(win)
    ui.reset_focus()
    GLib.timeout_add(700, ui.poll)
    Gtk.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
