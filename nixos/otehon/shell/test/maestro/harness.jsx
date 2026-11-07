import React from "react";
import { createRoot } from "react-dom/client";
import { Bunsho } from "../../src/apps/bunsho.cljc";
createRoot(document.getElementById("root")).render(<Bunsho accountDid="did:test:maestro" />);
