// Third-party UI pieces for the dashboard, bundled into assets/vendor.js:
// the real Sonner toaster (React) and Torph's dependency-free TextMorph.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import { TextMorph } from "torph";

const host = document.createElement("div");
document.body.append(host);
createRoot(host).render(
  createElement(Toaster, { theme: "dark", richColors: true, position: "bottom-right" }),
);

window.notify = (title, type = "info", description = "") =>
  (toast[type] || toast)(title, description ? { description } : undefined);
window.TextMorph = TextMorph;
