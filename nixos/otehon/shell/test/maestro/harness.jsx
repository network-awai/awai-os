import React from "react";
import { createRoot } from "react-dom/client";
import { Bunsho } from "../../src/apps/bunsho.cljc";
import { Hyokeisan } from "../../src/apps/hyokeisan.cljc";
const App = new URLSearchParams(location.search).get("app") === "sheet" ? Hyokeisan : Bunsho;
createRoot(document.getElementById("root")).render(<App accountDid="did:test:maestro" />);
