// Punto de entrada del paquete único: deja React/ReactDOM/htm en window (como los <script> de
// index.html) y recién entonces carga la web, que los toma de ahí (src/components/html.js).
import React from "react";
import ReactDOM from "react-dom";
import htm from "htm";
window.React = React;
window.ReactDOM = ReactDOM;
window.htm = htm;
await import("../../src/main.js");
