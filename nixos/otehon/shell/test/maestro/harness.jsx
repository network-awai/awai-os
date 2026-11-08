import React from "react";
import { createRoot } from "react-dom/client";
import { Bunsho } from "../../src/apps/bunsho.cljc";
import { Hyokeisan } from "../../src/apps/hyokeisan.cljc";
import { Yotei } from "../../src/apps/yotei.cljc";
const app = new URLSearchParams(location.search).get("app");
const App = app === "sheet" ? Hyokeisan : app === "yotei" ? Yotei : Bunsho;
createRoot(document.getElementById("root")).render(<App accountDid="did:test:maestro" />);
