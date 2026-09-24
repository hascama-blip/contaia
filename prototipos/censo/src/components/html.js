// Puente con React (cargado desde cdnjs) + htm: componentes con plantillas
// html`...` sin paso de compilación. Es el "JSX" de este prototipo.
const React = window.React;

export const html = window.htm.bind(React.createElement);
export const { useState, useEffect, useMemo, useRef, useCallback, useContext, createContext, Fragment } = React;
